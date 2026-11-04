"""Open the integration via the same config-flow manager as the UI."""

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType


async def test_user_can_open_medication_setup(hass):
    result = await hass.config_entries.flow.async_init(
        "medication_tracker", context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    assert "title" in result["data_schema"].schema
    hass.config_entries.flow.async_abort(result["flow_id"])
