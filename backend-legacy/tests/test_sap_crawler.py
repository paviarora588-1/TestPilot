import json
from io import BytesIO

from fastapi import UploadFile
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.api.endpoints import import_sap_gui_crawler_output, parse_crawler_payload, sap_crawler_import_summary, sap_crawler_item_to_object, sap_gui_crawler_script_v2
from app.db.session import Base
from app.models.models import ObjectRepository, Product


def test_jsonl_parser_separates_crawler_events_from_objects():
    raw = (
        json.dumps({"event": "crawler_start", "crawler_version": "2"})
        + "\n"
        + json.dumps({"id": "wnd[0]/usr/ctxtFIELD", "type": "GuiCTextField"})
    ).encode("utf-16")

    payload = parse_crawler_payload(raw)

    assert payload["events"][0]["event"] == "crawler_start"
    assert payload["objects"] == [{"id": "wnd[0]/usr/ctxtFIELD", "type": "GuiCTextField"}]


def test_crawler_export_preserves_transaction_system_and_product_context():
    script = sap_gui_crawler_script_v2("Finance Product", ["Vendor"])

    assert '""product""' in script
    assert '""transaction""' in script
    assert '""system""' in script
    assert '""technical_path""' in script
    assert '""required""' in script
    assert '""changeable""' in script
    assert '""action_hint""' in script
    assert '""screen_key""' in script
    assert "stateful_safe_exploration" in script
    assert "guarded_exploration_start" in script
    assert "crawler_action_candidate" in script
    assert "crawler_transition" in script
    assert "crawler_external_navigation_blocked" in script
    assert "crawler_action_skipped" in script
    assert "IsRiskyActionLabel" in script
    assert "IsProductAreaAction" in script
    assert "IsProductAreaButton" in script
    assert "IsExternalTransaction" in script
    assert "SafeSessionInfo" in script
    assert "Button captured but not pressed in strict in-transaction mode" in script
    assert "WatchUserNavigation" in script
    assert "user_guided_capture_start" in script
    assert "user_guided_screen_captured" in script
    assert "user_guided_screen_skipped" in script
    assert "IsTargetTransaction" in script
    assert "component.Press" not in script
    assert "actionKey = ScreenKey()" in script
    assert "ExploreComponent session.FindById(\"wnd[0]\"), 0" in script
    assert "Function ModuleName()" in script
    assert "ModuleName = Trim(targetCode)" in script


def test_crawler_item_maps_transaction_to_library_module():
    data = sap_crawler_item_to_object(
        {
            "id": "wnd[0]/usr/ctxtLIFNR",
            "type": "GuiCTextField",
            "object_name": "Vendor",
            "module": "XK03",
            "transaction": "XK03",
            "area_or_tab": "General Data",
            "feature": "Address",
            "screen": "Display Vendor",
            "required": "true",
            "changeable": "true",
            "position": "left=10;top=20;width=100;height=20",
        }
    )

    assert data is not None
    assert data["module"] == "XK03"
    assert data["area_or_tab"] == "General Data"
    assert data["technical_path"] == "wnd[0]/usr/ctxtLIFNR"
    assert "enter_text" in data["supported_actions"]
    assert "verify_required" in data["supported_actions"]
    assert "position: left=10;top=20;width=100;height=20" in data["notes"]


def test_crawler_import_summary_reports_stateful_exploration_coverage():
    summary = sap_crawler_import_summary(
        [
            {
                "id": "wnd[0]/usr/tabsMAIN/tabpGENERAL",
                "type": "GuiTab",
                "module": "TX01",
                "area_or_tab": "General",
                "screen": "Entry",
            },
            {
                "id": "wnd[0]/usr/btnDETAIL",
                "type": "GuiButton",
                "module": "TX01",
                "area_or_tab": "Details",
                "screen": "Detail",
            },
        ],
        [
            {"event": "crawler_start", "crawler_version": "2.3", "mode": "stateful_safe_exploration", "target_code": "TX01"},
            {"event": "screen_seen", "screen_key": "TX01|wnd[0]|Entry"},
            {"event": "crawler_action_candidate", "id": "wnd[0]/usr/btnDETAIL"},
            {"event": "crawler_transition", "from_screen_key": "TX01|wnd[0]|Entry", "to_screen_key": "TX01|wnd[0]|Detail"},
            {"event": "crawler_action_skipped", "id": "wnd[0]/tbar[0]/btn[11]"},
            {"event": "crawler_external_navigation_blocked", "to_transaction": "SE11"},
            {"event": "user_guided_screen_captured", "screen_key": "TX01|wnd[0]|Manual"},
            {"event": "user_guided_screen_skipped", "transaction": "SE11"},
        ],
    )

    assert summary["mode"] == "stateful_safe_exploration"
    assert summary["screen_states"] == 3
    assert summary["navigation_edges"] == 1
    assert summary["exploration_candidates"] == 1
    assert summary["skipped_actions"] == 1
    assert summary["external_navigation_blocked"] == 1
    assert summary["user_guided_screens"] == 1
    assert summary["user_guided_skipped"] == 1
    assert summary["modules"] == {"TX01": 2}
    assert summary["areas"] == {"General": 1, "Details": 1}


def test_crawler_import_updates_changed_path_and_keeps_history():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Finance", product_type="SAP GUI")
        db.add(product)
        db.flush()
        db.add(
            ObjectRepository(
                product_id=product.id,
                object_name="Vendor",
                platform="SAP GUI",
                module="XK03",
                feature="Address",
                screen="Display Vendor",
                object_type="input",
                technical_path="wnd[0]/usr/ctxtOLD",
                scope="SCREEN",
                screen_type="SCREEN",
            )
        )
        db.commit()

        payload = json.dumps(
            {
                "objects": [
                    {
                        "id": "wnd[0]/usr/ctxtNEW",
                        "type": "GuiCTextField",
                        "object_name": "Vendor",
                        "module": "XK03",
                        "feature": "Address",
                        "screen": "Display Vendor",
                    }
                ]
            }
        ).encode()
        upload = UploadFile(filename="crawler.json", file=BytesIO(payload))

        import asyncio

        result = asyncio.run(import_sap_gui_crawler_output(product.id, upload, db))
        rows = db.scalars(select(ObjectRepository)).all()

        assert result["imported"] == 0
        assert result["updated"] == 1
        assert len(rows) == 1
        assert rows[0].technical_path == "wnd[0]/usr/ctxtNEW"
        assert rows[0].path_history[0]["before"] == "wnd[0]/usr/ctxtOLD"
        assert rows[0].path_history[0]["after"] == "wnd[0]/usr/ctxtNEW"


def test_crawler_import_keeps_same_named_controls_with_different_paths():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Finance", product_type="SAP GUI")
        db.add(product)
        db.flush()

        payload = json.dumps(
            {
                "objects": [
                    {
                        "id": "wnd[0]/usr/subAREA1/txtFIELD",
                        "type": "GuiTextField",
                        "object_name": "Amount",
                        "module": "TX01",
                        "feature": "Entry",
                        "screen": "Document Entry",
                    },
                    {
                        "id": "wnd[0]/usr/subAREA2/txtFIELD",
                        "type": "GuiTextField",
                        "object_name": "Amount",
                        "module": "TX01",
                        "feature": "Entry",
                        "screen": "Document Entry",
                    },
                ]
            }
        ).encode()
        upload = UploadFile(filename="crawler.json", file=BytesIO(payload))

        import asyncio

        result = asyncio.run(import_sap_gui_crawler_output(product.id, upload, db))
        rows = db.scalars(select(ObjectRepository).order_by(ObjectRepository.technical_path)).all()

        assert result["imported"] == 2
        assert result["updated"] == 0
        assert len(rows) == 2
        assert [row.technical_path for row in rows] == [
            "wnd[0]/usr/subAREA1/txtFIELD",
            "wnd[0]/usr/subAREA2/txtFIELD",
        ]
