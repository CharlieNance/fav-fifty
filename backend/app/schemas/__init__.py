"""Pydantic schemas — the API request/response contract.

These define and validate the shapes that cross the HTTP boundary, kept separate
from the ORM models so the public API can evolve independently of the database.
"""
