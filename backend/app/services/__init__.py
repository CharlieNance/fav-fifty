"""Service layer — business logic.

Routers stay thin and delegate here; services own the rules (validation beyond
shape, authorization checks, orchestration) and talk to the data layer. Because
services take their dependencies as arguments, they can be unit-tested without
spinning up the HTTP app.
"""
