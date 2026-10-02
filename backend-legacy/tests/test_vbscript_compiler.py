from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.api.endpoints import (
    apply_execution_failure_feedback,
    build_vbscript,
    calibrated_review_risk,
    enrich_knowledge_summary,
    manual_action_requirements,
    mapping_completeness_issues,
    sap_gui_crawler_script_v2,
    sap_script_validation_issues,
    sap_transaction_from_text,
    should_use_local_knowledge_fallback,
    script_compilation_report,
)
from app.db.session import Base
from app.models.models import ExecutionRun, GeneratedScript, ObjectRepository, Product, StepMapping, TestCase, TestStep
from fastapi import HTTPException


def _mapping(db, product, case, step, number, obj, action, data=""):
    row = StepMapping(
        product_id=product.id,
        test_case_id=case.id,
        test_step_id=step.id,
        step_number=number,
        manual_step=step.instruction,
        object_id=obj.id,
        mapped_object_id=obj.id,
        ai_understanding="Mapped action",
        automation_action=action,
        test_data=data,
        expected_result="Action succeeds",
        confidence=95,
        risk_score=10,
        status="approved",
        approved=True,
    )
    db.add(row)
    db.flush()
    return row


def test_vbscript_compiler_normalizes_paths_and_uses_sap_control_methods():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        case = TestCase(product_id=1, external_id="TC-1", title="Create item")
        db.add(product)
        db.flush()
        case.product_id = product.id
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=1, instruction="Enter Item ID as ITEM1 and save")
        db.add(step)
        db.flush()
        field = ObjectRepository(product_id=product.id, object_name="Item ID", platform="SAP GUI", object_type="input", technical_path="/app/con[0]/ses[0]/wnd[0]/usr/ctxtITEM", supported_actions=["enter_text"])
        menu = ObjectRepository(product_id=product.id, object_name="Save", platform="SAP GUI", object_type="menu", technical_path="/app/con[0]/ses[0]/wnd[0]/mbar/menu[0]", supported_actions=["click"])
        db.add_all([field, menu])
        db.flush()
        mappings = [
            _mapping(db, product, case, step, 1, field, "enter_text", "ITEM1"),
            _mapping(db, product, case, step, 2, menu, "click"),
        ]

        code = build_vbscript(case, mappings, db)

        assert 'findById("wnd[0]/usr/ctxtITEM").Text = "ITEM1"' in code
        assert 'findById("wnd[0]/mbar/menu[0]").Select' in code
        assert 'findById("/app/' not in code
        assert "Sub WaitForSap" in code
        assert "Sub CheckStatusBar" in code
        assert sap_script_validation_issues(code, mappings, db) == []


def test_vbscript_compiler_drives_sap_command_bar_from_manual_tcode():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        db.add(product)
        db.flush()
        case = TestCase(product_id=product.id, external_id="TC-TCODE", title="Open transaction")
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=1, instruction="Execute PFCG")
        db.add(step)
        db.flush()
        root = ObjectRepository(
            product_id=product.id,
            object_name="SAP Easy Access",
            platform="SAP GUI",
            object_type="window",
            technical_path="/app/con[0]/ses[0]/wnd[0]",
            supported_actions=["open"],
        )
        db.add(root)
        db.flush()
        mappings = [_mapping(db, product, case, step, 1, root, "open")]

        code = build_vbscript(case, mappings, db)

        assert 'findById("wnd[0]/tbar[0]/okcd").Text = "/nPFCG"' in code
        assert 'findById("wnd[0]").SendVKey 0' in code
        assert sap_transaction_from_text("Execute transaction SU01") == "/nSU01"
        assert manual_action_requirements("Execute PFCG")[0]["target"] == "/nPFCG"


def test_vbscript_compiler_preserves_custom_sap_namespace_tcode():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        db.add(product)
        db.flush()
        case = TestCase(product_id=product.id, external_id="TC-CUSTOM", title="Open custom module")
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=1, instruction="Execute /n/demo/start")
        db.add(step)
        db.flush()
        root = ObjectRepository(
            product_id=product.id,
            object_name="Custom SAP Module",
            platform="SAP GUI",
            object_type="window",
            technical_path="/app/con[0]/ses[0]/wnd[0]",
            supported_actions=["open"],
        )
        db.add(root)
        db.flush()
        mappings = [_mapping(db, product, case, step, 1, root, "open")]

        code = build_vbscript(case, mappings, db)

        assert sap_transaction_from_text("Execute /n/demo/start") == "/n/demo/start"
        assert manual_action_requirements("Execute /n/demo/start")[0]["target"] == "/n/demo/start"
        assert 'findById("wnd[0]/tbar[0]/okcd").Text = "/n/demo/start"' in code


def test_script_compilation_report_marks_ai_as_reviewer_not_script_author():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        db.add(product)
        db.flush()
        case = TestCase(product_id=product.id, external_id="TC-REPORT", title="Compile report")
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=1, instruction="Execute PFCG")
        db.add(step)
        db.flush()
        root = ObjectRepository(
            product_id=product.id,
            object_name="SAP Easy Access",
            platform="SAP GUI",
            object_type="window",
            technical_path="/app/con[0]/ses[0]/wnd[0]",
            supported_actions=["open"],
        )
        db.add(root)
        db.flush()
        mappings = [_mapping(db, product, case, step, 1, root, "open")]
        code = build_vbscript(case, mappings, db)

        report = script_compilation_report("SAP_GUI_VBSCRIPT", case, mappings, code, [], db)

        assert report["engine"] == "deterministic_mapping_compiler"
        assert report["ai_wrote_script_body"] is False
        assert report["mapping_count"] == 1
        assert report["validation_passed"] is True


def test_mapping_completeness_detects_omitted_manual_actions():
    requirements = manual_action_requirements("Execute /o/app navigate to Conflict Repository Click edit mode Click Create")
    displays = [item["display"] for item in requirements]

    assert "open /o/app" in displays
    assert "navigate Conflict Repository" in displays
    assert "click edit mode" in displays
    assert "click Create" in displays

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        db.add(product)
        db.flush()
        case = TestCase(product_id=product.id, external_id="TC-2", title="Create item")
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=1, instruction="Execute /o/app navigate to Conflict Repository Click edit mode Click Create")
        db.add(step)
        db.flush()
        root = ObjectRepository(product_id=product.id, object_name="Home", platform="SAP GUI", object_type="input", technical_path="/app/con[0]/ses[0]/wnd[0]")
        db.add(root)
        db.flush()
        mappings = [_mapping(db, product, case, step, 1, root, "open", "/o/app")]

        issues = mapping_completeness_issues(case, mappings, db)

        assert any("Conflict Repository" in issue for issue in issues)
        assert any("edit mode" in issue for issue in issues)
        assert any("Create" in issue for issue in issues)


def test_review_risk_is_calibrated_when_provider_approves_without_findings():
    mapping = type("Mapping", (), {"risk_score": 10})()
    review = {
        "approval_recommendation": "approve",
        "risk_score": 95,
        "issues": [],
        "risk_warnings": [],
        "missing_waits": [],
        "missing_assertions": [],
        "weak_error_handling": [],
    }

    effective = calibrated_review_risk(review, [mapping], [])

    assert effective == 10
    assert review["provider_risk_score"] == 95


def test_execution_feedback_demotes_failed_mapping():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        product = Product(name="Product", product_type="SAP GUI")
        db.add(product)
        db.flush()
        case = TestCase(product_id=product.id, external_id="TC-3", title="Create item")
        db.add(case)
        db.flush()
        step = TestStep(test_case_id=case.id, step_order=4, instruction="Click Create")
        db.add(step)
        db.flush()
        button = ObjectRepository(
            product_id=product.id,
            object_name="Create (F5)",
            platform="SAP GUI",
            object_type="button",
            technical_path="/app/con[0]/ses[0]/wnd[0]/tbar[1]/btn[5]",
            supported_actions=["click"],
            confidence=97,
            verification_status="Unverified",
        )
        db.add(button)
        db.flush()
        mapping = _mapping(db, product, case, step, 4, button, "click")
        script = GeneratedScript(
            product_id=product.id,
            test_case_id=case.id,
            framework="SAP_GUI_VBSCRIPT",
            code='session.findById("wnd[0]/tbar[1]/btn[5]").Press',
            file_name="TC-3.vbs",
            file_path="TC-3.vbs",
            command="cscript TC-3.vbs",
            review_status="AI_REVIEWED",
            status="AI_REVIEWED",
        )
        db.add(script)
        db.flush()
        run = ExecutionRun(product_id=product.id, script_id=script.id, test_case_id=case.id, status="FAILED", logs=[])
        db.add(run)
        db.flush()

        feedback = apply_execution_failure_feedback(
            run,
            script,
            db,
            ["Step 4: Create (F5) failed: The control could not be found by id."],
        )

        assert feedback["failed_step_order"] == 4
        assert mapping.status == "needs_review"
        assert mapping.approved is False
        assert mapping.confidence == 40
        assert button.verification_status == "Needs Review"
        assert run.failure_analysis_json["category"] == "object_issue"


def test_knowledge_summary_enrichment_replaces_generic_cover_page_summary():
    ai_summary = {
        "modules_detected": ["User Guide"],
        "features_detected": ["Installation & Initial Configuration"],
        "business_rules": ["Warranty and Disclaimer"],
        "missing_gaps": ["No missing gaps"],
        "readiness_score": 85,
    }
    full_text = "\n".join(
        [
            "Security Weaver User Guide",
            "Warranty and Disclaimer",
            "4 Conflict Repository",
            "4.1 Maintaining Functions",
            "4.2 Maintaining Conflicts",
            "4.3 Critical Transactions",
            "5 Reports",
            "5.1 Running User Analysis",
            "5.2 Running Role Analysis",
        ]
    )

    enriched = enrich_knowledge_summary(ai_summary, full_text)

    assert "User Guide" not in enriched["modules_detected"]
    assert "Conflict Repository" in enriched["modules_detected"]
    assert "Maintaining Functions" in enriched["features_detected"]
    assert any("Capture SAP GUI object paths" in gap for gap in enriched["missing_gaps"])


def test_local_knowledge_timeout_uses_manual_fallback_path():
    exc = HTTPException(status_code=502, detail="Local AI request failed for Knowledge extraction: Read timed out.")

    assert should_use_local_knowledge_fallback(exc) is True


def test_sap_gui_crawler_v2_is_guarded_exploration_capture():
    script = sap_gui_crawler_script_v2("Product", ["PFCG"], target_code="/nYOUR_TCODE")

    assert 'targetCode = "/nYOUR_TCODE"' in script
    assert "stateful_safe_exploration" in script
    assert "ActionHint" in script
    assert "SafeBoolProp" in script
    assert "SafeLongProp" in script
    assert "SafeSessionInfo" in script
    assert "ScreenKey" in script
    assert "ExploreScreen" in script
    assert "TryExplore" in script
    assert "ExplorationActionKind" in script
    assert "IsRiskyActionLabel" in script
    assert "IsSafeNavigationLabel" in script
    assert '""crawler_action_candidate""' in script
    assert '""crawler_transition""' in script
    assert '""crawler_external_navigation_blocked""' in script
    assert '""crawler_action_skipped""' in script
    assert "IsProductAreaAction" in script
    assert "IsProductAreaButton" in script
    assert "IsExternalTransaction" in script
    assert "Button captured but not pressed in strict in-transaction mode" in script
    assert "WatchUserNavigation" in script
    assert "user_guided_capture_start" in script
    assert "user_guided_screen_captured" in script
    assert "user_guided_screen_skipped" in script
    assert "IsTargetTransaction" in script
    assert "maxChildren = 5000" in script
    assert "maxExploreActions = 80" in script
    assert '""crawler_limit_reached""' in script
    assert 'If InStr(typ, "shell") > 0 Or InStr(typ, "grid") > 0 Then Exit Sub' not in script
    assert 'CaptureAll "Initial product library scan"' in script
    assert 'CaptureAll "Final product library scan"' in script
    assert "actionKey = ScreenKey()" in script
    assert "DiscoverCurrentScreen" not in script
    assert "ExploreSafeButtons" not in script
    assert "OpenComponent" not in script
    assert "component.Press" not in script
    assert "component.Select" in script
    for risky in [" save ", " delete ", " post ", " execute ", " approve ", " create ", " change "]:
        assert risky in script.lower()
    assert "PFCG" not in script
