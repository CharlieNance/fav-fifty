"""The IP block list: which addresses the edge refuses (docs/ARCHITECTURE.md
§Abuse view, docs/ABUSE_PROTECTION_PLAN.md Layer 1, WAF rule 5).

The WAF is the single source of truth and the only enforcer: a blocked visitor never
reaches the app, the Lambda routes included. The app only reads and edits the list:

* ``WafBlockList`` (AWS): two WAFv2 IP sets, IPv4 and IPv6 (WAF keeps one address
  family per set), scope ``CLOUDFRONT``, so the API is in us-east-1. The box's IAM
  user may only ``GetIPSet``/``UpdateIPSet`` on those two ARNs.
* ``LocalFileBlockList`` (dev): a git-ignored JSON file. Nothing enforces it; it's
  there so the admin page works the same way locally.
* ``MemoryBlockList``: tests.

Who blocked an address and why lives in the audit log, not here: WAF IP sets hold
bare CIDRs.
"""

import ipaddress
import json
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from fastapi import Request

from app.core.config import Settings, settings

logger = logging.getLogger(__name__)

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

# The widest range one entry may block. A /24 is 256 IPv4 addresses; a /48 is one
# typical IPv6 site. Anything wider risks shutting out real people by accident.
MIN_PREFIX = {4: 24, 6: 48}
# WAF allows 10,000 per set; this keeps the list (and the page) human-sized.
MAX_ENTRIES = 1000


class BlockListError(Exception):
    """The block list couldn't be read or changed (AWS refused, file unreadable)."""


class BlockListNotConfiguredError(BlockListError):
    """The WAF source is selected but its IP set ARNs aren't set."""


def parse_network(text: str, *, check_width: bool = True) -> IpNetwork:
    """``"203.0.113.7"`` → ``203.0.113.7/32``. ``ValueError`` (with a message for the
    owner) for something that isn't an address or range, or one that's too wide."""
    try:
        network = ipaddress.ip_network(text.strip(), strict=False)
    except ValueError:
        raise ValueError(f"Not an IP address or range: {text.strip()[:64]!r}") from None
    widest = MIN_PREFIX[network.version]
    if check_width and network.prefixlen < widest:
        raise ValueError(f"Too wide: block at most a /{widest} at once (IPv{network.version}).")
    return network


def normalized(entries: list[str]) -> list[str]:
    """Entries as ``str(ip_network)``, so they compare equal to what we'd write."""
    out = []
    for entry in entries:
        try:
            out.append(str(ipaddress.ip_network(entry, strict=False)))
        except ValueError:
            out.append(entry)
    return out


class BlockList(Protocol):
    #: "waf" when the list is enforced at the edge; "local" / "memory" when it isn't.
    source: str

    def entries(self) -> list[str]: ...

    def add(self, network: IpNetwork) -> None: ...

    def remove(self, network: IpNetwork) -> None: ...


class MemoryBlockList:
    source = "memory"

    def __init__(self) -> None:
        self.networks: list[str] = []

    def entries(self) -> list[str]:
        return list(self.networks)

    def add(self, network: IpNetwork) -> None:
        if str(network) not in self.networks:
            self.networks.append(str(network))

    def remove(self, network: IpNetwork) -> None:
        self.networks = [n for n in self.networks if n != str(network)]


class LocalFileBlockList:
    source = "local"

    def __init__(self, path: Path):
        self.path = path
        # Sync routes run in a thread pool: serialize the read-modify-write.
        self._lock = threading.Lock()

    def entries(self) -> list[str]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_bytes())
        except (OSError, ValueError) as error:
            raise BlockListError(f"Can't read {self.path.name}: {error}") from error
        return normalized([str(n) for n in data.get("networks", [])])

    def _write(self, networks: list[str]) -> None:
        body = json.dumps({"networks": networks}, indent=2) + "\n"
        tmp = self.path.with_suffix(".tmp")
        tmp.write_bytes(body.encode())  # Bytes: no CRLF translation on Windows.
        os.replace(tmp, self.path)

    def add(self, network: IpNetwork) -> None:
        with self._lock:
            current = self.entries()
            if str(network) not in current:
                self._write([*current, str(network)])

    def remove(self, network: IpNetwork) -> None:
        with self._lock:
            self._write([n for n in self.entries() if n != str(network)])


@dataclass(frozen=True)
class IpSetRef:
    name: str
    id: str

    @classmethod
    def from_arn(cls, arn: str) -> "IpSetRef":
        """``arn:aws:wafv2:us-east-1:123:global/ipset/<name>/<id>`` → name and id."""
        parts = arn.split("/")
        if len(parts) < 3 or parts[-3] != "ipset":
            raise BlockListNotConfiguredError(f"Not a WAF IP set ARN: {arn!r}")
        return cls(name=parts[-2], id=parts[-1])


# How many times to retry an update that lost a race with another writer.
_LOCK_RETRIES = 3


class WafBlockList:
    source = "waf"
    scope = "CLOUDFRONT"

    def __init__(
        self,
        ipv4_arn: str,
        ipv6_arn: str,
        client_factory: Callable[[], Any] | None = None,
    ):
        self._arns = {4: ipv4_arn, 6: ipv6_arn}
        self._client_factory = client_factory or _wafv2_client
        self._client: Any = None

    def _ref(self, version: int) -> IpSetRef:
        arn = self._arns[version]
        if not arn:
            raise BlockListNotConfiguredError(
                "The WAF block list isn't configured (WAF_IPV4_IP_SET_ARN / WAF_IPV6_IP_SET_ARN)."
            )
        return IpSetRef.from_arn(arn)

    def _waf(self) -> Any:
        if self._client is None:
            self._client = self._client_factory()
        return self._client

    def _get(self, version: int) -> tuple[list[str], str]:
        ref = self._ref(version)
        try:
            found = self._waf().get_ip_set(Name=ref.name, Scope=self.scope, Id=ref.id)
        except Exception as error:
            logger.exception("WAF GetIPSet failed")
            raise BlockListError(f"Couldn't read the WAF block list: {error}") from error
        return normalized(found["IPSet"]["Addresses"]), found["LockToken"]

    def entries(self) -> list[str]:
        return self._get(4)[0] + self._get(6)[0]

    def _update(self, network: IpNetwork, change: Callable[[list[str]], list[str]]) -> None:
        ref = self._ref(network.version)
        for attempt in range(_LOCK_RETRIES):
            addresses, token = self._get(network.version)
            try:
                self._waf().update_ip_set(
                    Name=ref.name,
                    Scope=self.scope,
                    Id=ref.id,
                    Addresses=change(addresses),
                    LockToken=token,
                )
                return
            except Exception as error:
                code = getattr(error, "response", {}).get("Error", {}).get("Code")
                if code == "WAFOptimisticLockException" and attempt < _LOCK_RETRIES - 1:
                    continue  # Someone else changed it first: re-read and try again.
                logger.exception("WAF UpdateIPSet failed")
                raise BlockListError(f"Couldn't update the WAF block list: {error}") from error

    def add(self, network: IpNetwork) -> None:
        self._update(network, lambda current: sorted({*current, str(network)}))

    def remove(self, network: IpNetwork) -> None:
        self._update(network, lambda current: [n for n in current if n != str(network)])


def _wafv2_client() -> Any:
    import boto3  # Deferred: only AWS deployments pay its import cost.

    # CloudFront-scoped WAF resources live in us-east-1, wherever the box is.
    return boto3.client("wafv2", region_name="us-east-1")


def build_blocklist(config: Settings = settings) -> BlockList:
    """The block list this deployment uses. Never touches AWS until first used."""
    if config.ip_blocklist_source == "waf":
        return WafBlockList(config.waf_ipv4_ip_set_arn, config.waf_ipv6_ip_set_arn)
    return LocalFileBlockList(Path(config.ip_blocklist_local_path))


def get_ip_blocklist(request: Request) -> BlockList:
    """Dependency: the app's block list (tests swap in a ``MemoryBlockList``)."""
    blocklist: BlockList = request.app.state.ip_blocklist
    return blocklist
