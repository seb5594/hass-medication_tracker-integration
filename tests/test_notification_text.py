"""Notification regression tests; run with python -m unittest discover -s tests."""

import importlib.util
from pathlib import Path
from string import Formatter
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


ROOT = Path(__file__).resolve().parents[1] / "custom_components/medication_tracker"
# Load the notification modules without running integration setup or requiring HA.
PACKAGE = "_medication_notification_tests"
package = ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package


def load_module(name):
    spec = importlib.util.spec_from_file_location(f"{PACKAGE}.{name}", ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


const = load_module("const")
text = load_module("notification_text")
coordinator_module = ModuleType(f"{PACKAGE}.coordinator")
coordinator_module.extract_scheduled_time = lambda state: state.get("next_dose_time")
core = ModuleType("homeassistant.core")
core.HomeAssistant = Mock
core.callback = lambda function: function
with patch.dict(sys.modules, {
    "homeassistant": ModuleType("homeassistant"),
    "homeassistant.core": core,
    "homeassistant.helpers": Mock(),
    "homeassistant.util": Mock(),
    "homeassistant.util.dt": Mock(),
    f"{PACKAGE}.coordinator": coordinator_module,
}):
    notify = load_module("notify")


class NotificationTemplateTests(unittest.TestCase):
    def test_defaults_and_saved_defaults_follow_system_language(self):
        for key, english in text.ENGLISH_TEMPLATES.items():
            german = text.GERMAN_TEMPLATES[key]
            for language in ("de", "de-DE", "de-AT", "de_CH", "DE"):
                for config in ({}, {key: english}, {key: german}):
                    with self.subTest(key=key, language=language, config=config):
                        self.assertEqual(text.notification_template(config, key, language), german)

    def test_english_fallback_and_language_changes(self):
        for key, english in text.ENGLISH_TEMPLATES.items():
            for language in ("en", "en-GB", "fr", "", None):
                with self.subTest(key=key, language=language):
                    self.assertEqual(text.notification_template({}, key, language), english)
                    self.assertEqual(text.notification_template(
                        {key: text.GERMAN_TEMPLATES[key]}, key, language
                    ), english)

    def test_custom_text_and_explicit_empty_text_are_preserved(self):
        for key in text.ENGLISH_TEMPLATES:
            for custom in ("Bitte {medication} einnehmen!", ""):
                for language in ("de", "en"):
                    self.assertEqual(text.notification_template({key: custom}, key, language), custom)

    def test_translations_preserve_all_placeholders(self):
        def fields(template):
            return {field for _, field, _, _ in Formatter().parse(template) if field}

        self.assertEqual(text.ENGLISH_TEMPLATES.keys(), text.GERMAN_TEMPLATES.keys())
        for key, english in text.ENGLISH_TEMPLATES.items():
            self.assertEqual(fields(english), fields(text.GERMAN_TEMPLATES[key]))


class NotificationDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_all_alert_types_send_localized_payloads(self):
        med = {"id": "test-med", "name": "Testmedikament", "dose": "10 mg"}
        placeholders = {
            "medication": med["name"], "dose": med["dose"], "time": "08:00",
            "overdue_since": "08:00", "stock": "2",
        }
        state = {
            "is_due_now": True, "due_at_time": "08:00", "is_overdue": True,
            "overdue_since": "08:00", "is_due_soon": True,
            "next_dose_time": "08:00", "is_low_stock": True, "current_stock": 2,
        }
        for kind in const.NOTIF_SOUND_KEYS_BY_TYPE:
            for language, templates in (("de-DE", text.GERMAN_TEMPLATES), ("fr", text.ENGLISH_TEMPLATES)):
                for ios in (False, True):
                    with self.subTest(kind=kind, language=language, ios=ios):
                        config = {
                            **text.ENGLISH_TEMPLATES,
                            "notify_target": "notify.mobile_app_test",
                            f"{kind}_enabled": True,
                        }
                        hass = SimpleNamespace(
                            config=SimpleNamespace(language=language),
                            bus=Mock(), services=SimpleNamespace(async_call=AsyncMock()),
                        )
                        coordinator = SimpleNamespace(
                            notification_config=config,
                            get_medication=lambda _: med,
                            get_med_state=lambda _: state,
                        )
                        notifier = notify.MedicationNotifier(hass, coordinator)
                        with patch.object(notify, "_is_ios", return_value=ios):
                            if kind == "taken":
                                await notifier.async_notify_taken(med["id"])
                            else:
                                await getattr(notifier, f"_check_{kind}")(med, state, config, {})
                        payload = hass.services.async_call.call_args.args[2]
                        self.assertEqual(payload["title"], templates[f"{kind}_title"].format(**placeholders))
                        self.assertEqual(payload["message"], templates[f"{kind}_message"].format(**placeholders))
                        if kind in ("due", "overdue", "due_soon"):
                            self.assertEqual(payload["data"]["actions"], [{
                                "action": "MT_TAKEN_test-med",
                                "title": "Als eingenommen markieren" if language == "de-DE" else "Mark taken",
                            }])
                            self.assertEqual(payload["data"]["tag"], "medication_reminder_test-med")


if __name__ == "__main__":
    unittest.main()
