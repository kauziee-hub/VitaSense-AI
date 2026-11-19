from datetime import date, datetime

import pytest

from records.extractor import canonical_lab_key, normalise_extraction, slot_times
from records.store import RecordsStore
from records.summary import build_records_summary, records_prompt_lines, todays_doses


@pytest.fixture()
def store(tmp_path):
    return RecordsStore(tmp_path / "records.db")


def test_lab_names_map_to_one_key_without_false_matches():
    assert canonical_lab_key("HbA1c (Glycated Haemoglobin)") == "hba1c"
    assert canonical_lab_key("LDL Cholesterol - Direct") == "ldl"
    assert canonical_lab_key("VLDL Cholesterol") == "vldl"
    assert canonical_lab_key("Blood Sugar Fasting") == "fasting_glucose"
    assert canonical_lab_key("SGOT (AST)") == "ast"
    # "ast" sits inside "fasting"; it must not turn a glucose test into a liver test.
    assert canonical_lab_key("Fasting plasma glucose") == "fasting_glucose"
    assert canonical_lab_key("Serum Sodium") is None


def test_lab_flags_are_recomputed_from_the_printed_range():
    result = normalise_extraction(
        {
            "is_medical_document": True,
            "document_type": "lab_report",
            "summary": "Lipid profile",
            "lab_results": [
                {"name": "LDL Cholesterol", "value": 162, "unit": "mg/dL", "ref_low": 0, "ref_high": 100, "flag": "normal"},
                {"name": "HDL Cholesterol", "value": "48", "unit": "mg/dL", "ref_low": 40, "ref_high": 60},
                {"name": "Urine sugar", "value_text": "Negative"},
            ],
        }
    )
    flags = {lab["name"]: lab["flag"] for lab in result["lab_results"]}
    assert flags == {"LDL Cholesterol": "high", "HDL Cholesterol": "normal", "Urine sugar": "unknown"}


def test_prescription_timing_becomes_clock_times_and_end_date():
    result = normalise_extraction(
        {
            "is_medical_document": True,
            "document_type": "prescription",
            "summary": "Prescription",
            "document_date": "2026-11-10",
            "medications": [
                {"name": "Pantoprazole 40", "slots": ["morning"], "food_timing": "before_food", "duration_days": 14},
                {"name": "Paracetamol", "as_needed": True},
                {"name": "Metformin", "slots": ["night", "morning"], "food_timing": "after_food"},
            ],
        },
        today=date(2026, 11, 19),
    )
    pantoprazole, paracetamol, metformin = result["medications"]
    assert pantoprazole["times"] == ["07:30"]
    assert pantoprazole["start_date"] == "2026-11-10"
    assert pantoprazole["end_date"] == "2026-11-23"
    assert paracetamol["as_needed"] is True and paracetamol["times"] == []
    assert metformin["times"] == ["08:00", "21:00"]


def test_future_or_garbled_document_dates_are_dropped():
    future = normalise_extraction({"document_type": "lab_report", "summary": "x", "document_date": "2099-01-01"})
    garbled = normalise_extraction({"document_type": "lab_report", "summary": "x", "document_date": "31/12/2025"})
    assert future["document_date"] is None
    assert garbled["document_date"] is None


def test_slot_times_keep_day_order():
    assert slot_times(["night", "morning", "afternoon"], "any") == ["08:00", "14:00", "21:00"]


def _add_lab_report(store, user_id, when, ldl):
    return store.add_record(
        user_id=user_id,
        file_name="labs.pdf",
        mime_type="application/pdf",
        file_path=None,
        extracted=normalise_extraction(
            {
                "is_medical_document": True,
                "document_type": "lab_report",
                "summary": "Lipids",
                "document_date": when,
                "lab_results": [{"name": "LDL Cholesterol", "value": ldl, "unit": "mg/dL", "ref_low": 0, "ref_high": 100}],
                "conditions": ["Dyslipidaemia"],
                "allergies": ["Penicillin"],
            }
        ),
    )


def test_summary_keeps_the_latest_value_per_lab(store):
    _add_lab_report(store, 7, "2026-03-01", 170)
    _add_lab_report(store, 7, "2026-10-01", 128)

    summary = build_records_summary(store, 7)

    ldl = next(lab for lab in summary["latest_labs"] if lab["key"] == "ldl")
    assert ldl["value"] == 128 and ldl["date"] == "2026-10-01"
    assert summary["conditions"] == ["Dyslipidaemia"]
    assert summary["allergies"] == ["Penicillin"]
    assert summary["record_count"] == 2
    # Other users never see these records.
    assert build_records_summary(store, 8)["record_count"] == 0


def test_dose_schedule_statuses_and_adherence(store):
    med = store.add_medication(
        user_id=3,
        record_id=None,
        med={"name": "Metformin", "times": ["08:00", "21:00"], "start_date": "2026-11-18", "created_at": "2026-11-18T07:00:00"},
    )
    now = datetime(2026, 11, 19, 10, 30)
    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-18", dose_time="08:00", status="taken")
    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-18", dose_time="21:00", status="taken")

    schedule = todays_doses(store, 3, now=now)

    assert [(d["time"], d["status"]) for d in schedule["doses"]] == [("08:00", "missed"), ("21:00", "upcoming")]
    # Due so far: two yesterday (taken) and this morning's (not taken).
    assert schedule["adherence_7d"] == pytest.approx(0.67, abs=0.01)

    store.log_dose(user_id=3, med_id=med["id"], dose_date="2026-11-19", dose_time="08:00", status="taken")
    assert todays_doses(store, 3, now=now)["doses"][0]["status"] == "taken"


def test_finished_or_stopped_medicines_drop_off_today(store):
    store.add_medication(user_id=4, record_id=None, med={"name": "Old course", "times": ["08:00"], "start_date": "2026-01-01", "end_date": "2026-01-05"})
    stopped = store.add_medication(user_id=4, record_id=None, med={"name": "Stopped", "times": ["08:00"], "start_date": "2026-11-01"})
    store.update_medication(4, stopped["id"], {"active": False})

    assert todays_doses(store, 4, now=datetime(2026, 11, 19, 7, 0))["doses"] == []


def test_deleting_a_record_removes_its_medicines(store):
    record = _add_lab_report(store, 5, "2026-10-01", 120)
    store.add_medication(user_id=5, record_id=record["id"], med={"name": "Atorvastatin", "times": ["21:00"]})

    assert store.delete_record(5, record["id"]) is True
    assert store.list_medications(5) == []
    assert store.delete_record(5, record["id"]) is False


def test_prompt_lines_mention_records_and_current_medicines(store):
    _add_lab_report(store, 6, "2026-10-01", 162)
    store.add_medication(user_id=6, record_id=None, med={"name": "Atorvastatin", "strength": "10 mg", "times": ["21:00"], "start_date": "2026-10-02"})

    text = "\n".join(records_prompt_lines(build_records_summary(store, 6), today=date(2026, 11, 19)))

    assert "Penicillin" in text
    assert "LDL Cholesterol 162.0 mg/dL (HIGH)" in text
    assert "Atorvastatin 10 mg (21:00; started 2026-10-02, 48 days ago" in text


def test_doses_before_the_medicine_was_added_are_not_missed(store):
    """A prescription from last week added today at noon: this morning was never VitaSense's to remind."""
    store.add_medication(
        user_id=9,
        record_id=None,
        med={"name": "Pantoprazole", "times": ["07:30", "14:00", "21:00"], "start_date": "2026-11-12", "created_at": "2026-11-19T12:00:00"},
    )

    schedule = todays_doses(store, 9, now=datetime(2026, 11, 19, 14, 30))

    assert [(d["time"], d["status"]) for d in schedule["doses"]] == [("07:30", "unlogged"), ("14:00", "due"), ("21:00", "upcoming")]
    # Nothing has been due long enough to count yet: no adherence figure rather than 0%.
    assert schedule["adherence_7d"] is None


def test_same_file_is_found_by_hash_per_user(store):
    digest = store.file_hash(b"%PDF-1.7 same bytes")
    record = store.add_record(
        user_id=1, file_name="a.pdf", mime_type="application/pdf", file_path=None,
        extracted=normalise_extraction({"document_type": "lab_report", "summary": "x"}), file_hash=digest,
    )
    assert store.find_by_hash(1, digest)["id"] == record["id"]
    assert store.find_by_hash(2, digest) is None
    assert "file_hash" not in record
