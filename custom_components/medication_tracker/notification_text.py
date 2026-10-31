"""Localized notification defaults shared by the notifier and options flow."""

from __future__ import annotations

from typing import Any

from . import const


ENGLISH_TEMPLATES = {
    f"{kind}_{field}": getattr(const, f"DEFAULT_{kind.upper()}_{field.upper()}")
    for kind in ("due", "overdue", "due_soon", "taken", "low_stock")
    for field in ("title", "message")
}

GERMAN_TEMPLATES = {
    "due_title": "{medication} jetzt fällig",
    "due_message": "{medication} ({dose}) ist jetzt fällig.",
    "overdue_title": "{medication} überfällig",
    "overdue_message": (
        "{medication} ({dose}) war um {overdue_since} Uhr fällig "
        "und wurde noch nicht eingenommen."
    ),
    "due_soon_title": "{medication} bald fällig",
    "due_soon_message": "{medication} ({dose}) ist um {time} Uhr fällig.",
    "taken_title": "{medication} eingenommen",
    "taken_message": "{medication} ({dose}) wurde als eingenommen markiert.",
    "low_stock_title": "{medication}: geringer Vorrat",
    "low_stock_message": (
        "Von {medication} ({dose}) sind noch {stock} Einheit(en) vorhanden "
        "– bitte Vorrat auffüllen."
    ),
}


def _is_german(language: str | None) -> bool:
    """Use the system language, including regional tags such as de-AT."""
    return (language or "en").replace("_", "-").split("-", 1)[0].lower() == "de"


def notification_template(
    config: dict[str, Any], key: str, language: str | None
) -> str:
    """Localize defaults (including previously saved ones), preserving custom text.

    Keep recognizing both shipped languages so saving a template form does not
    freeze its defaults in one language when the system language changes later.
    """
    configured = config.get(key)
    if configured is not None and configured not in (
        ENGLISH_TEMPLATES[key], GERMAN_TEMPLATES[key]
    ):
        return configured
    templates = GERMAN_TEMPLATES if _is_german(language) else ENGLISH_TEMPLATES
    return templates[key]


def mark_taken_title(language: str | None) -> str:
    """Return the mobile notification action label."""
    return "Als eingenommen markieren" if _is_german(language) else "Mark taken"
