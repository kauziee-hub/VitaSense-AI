import pytest

from chat.safety_scanner import (
    CRISIS_MESSAGE,
    DIAGNOSIS_PATTERNS,
    DISCLAIMER,
    EMERGENCY_PATTERNS,
    ESCALATION_MESSAGE,
    NO_PRESCRIPTION_NOTE,
    SafetyResult,
    apply_escalation_override,
    scan_ai_response,
    scan_user_message,
)


# Unmistakable emergencies: never sent to the model.
EMERGENCY_EXAMPLES = [
    "I can't breathe",
    "I cannot breathe",
    "I'm struggling to breathe",
    "There is blood in vomit",
    "There is blood in stool",
    "There is blood in urine",
    "There is blood in poop",
    "I had bloody vomit",
    "I had bloody stool",
    "I had bloody urine",
    "I'm vomiting blood",
    "This is the worst headache",
    "There was loss of consciousness",
    "I passed out",
    "I keep fainting",
    "My face has facial droop",
    "I have arm weakness",
    "I have speech difficulty",
    "My speech slurred",
    "My throat is swelling",
    "My throat is closing",
    "This feels like anaphylaxis",
    "I took an overdose",
    "This may be poisoning",
    "He had a seizure",
    "I think I'm having a heart attack",
    "I am dying",
    "I'm dying",
    # Chest symptoms with a heart-attack companion sign
    "I have chest pain and I'm sweating",
    "Chest pressure spreading to my left arm",
    "Chest tightness and shortness of breath",
    "Crushing chest pain going to my jaw",
]

SELF_HARM_EXAMPLES = [
    "I feel suicidal",
    "I may self-harm",
    "I want to kill myself",
    "I want to die",
]

# Can be serious but usually is not: the model must answer, danger signs first.
TRIAGE_EXAMPLES = [
    ("I have chest pain", "chest symptom"),
    ("There is chest pressure after dinner", "chest symptom"),
    ("I have shortness of breath", "breathing difficulty"),
    ("I have difficulty breathing when I climb stairs", "breathing difficulty"),
    ("I have a severe headache", "severe headache"),
    ("Is this a heart attack?", "heart or stroke worry"),
    ("I think it is a stroke", "heart or stroke worry"),
    ("My heart is racing", "palpitations"),
    ("I feel dizzy since morning", "dizziness"),
]


DIAGNOSIS_EXAMPLES = [
    "You have influenza.",
    "This is definitely dengue.",
    "You are suffering from pneumonia.",
    "You are diagnosed with flu.",
    "I diagnose migraine.",
    "My diagnosis is bronchitis.",
    "This is a confirmed diagnosis.",
    "This is a confirmed condition.",
]


def test_escalation_message_exact_text():
    assert ESCALATION_MESSAGE == (
        "⚠️ The symptoms you're describing may require immediate medical attention. "
        "Please call emergency services (112 / 911) or go to your nearest emergency room immediately. "
        "Do not wait or self-medicate."
    )


def test_disclaimer_exact_text():
    assert DISCLAIMER == (
        "⚕️ This is not medical advice. If symptoms worsen or you have any concerns, "
        "please consult a qualified healthcare professional."
    )


@pytest.mark.parametrize("message", EMERGENCY_EXAMPLES)
def test_emergencies_block_user_message(message):
    result = scan_user_message(message)

    assert result.verdict == SafetyResult.BLOCK
    assert result.modified_response == ESCALATION_MESSAGE


@pytest.mark.parametrize("message", SELF_HARM_EXAMPLES)
def test_self_harm_gets_crisis_line_not_er_message(message):
    result = scan_user_message(message)

    assert result.verdict == SafetyResult.BLOCK
    assert result.modified_response == CRISIS_MESSAGE
    assert "14416" in CRISIS_MESSAGE


@pytest.mark.parametrize(("message", "flag"), TRIAGE_EXAMPLES)
def test_ambiguous_symptoms_are_triaged_not_blocked(message, flag):
    result = scan_user_message(message)

    assert result.verdict == SafetyResult.FLAG
    assert flag in result.triage_flags
    assert result.modified_response is None


def test_food_poisoning_is_not_treated_as_poisoning_emergency():
    result = scan_user_message("I think I have food poisoning from last night's biryani")

    assert result.verdict != SafetyResult.BLOCK


def test_normal_user_message_passes():
    result = scan_user_message("I have a mild headache after sleeping late")

    assert result.verdict == SafetyResult.PASS
    assert result.modified_response is None
    assert result.triage_flags == ()


@pytest.mark.parametrize("response", DIAGNOSIS_EXAMPLES)
def test_definitive_diagnosis_language_is_flagged(response):
    result = scan_ai_response(response)

    assert result.verdict == SafetyResult.FLAG
    assert result.modified_response is not None
    assert DISCLAIMER in result.modified_response


def test_disclaimer_is_appended_when_missing():
    result = scan_ai_response("One possible explanation is dehydration.")

    assert result.verdict == SafetyResult.FLAG
    assert result.modified_response == "One possible explanation is dehydration.\n\n" + DISCLAIMER


def test_existing_disclaimer_is_not_duplicated():
    response = "One possible explanation is dehydration.\n\n" + DISCLAIMER

    result = scan_ai_response(response)

    assert result.verdict == SafetyResult.PASS
    assert result.modified_response == response


def test_ai_may_name_serious_conditions_when_explaining_causes():
    response = "Chest pain like this is more often acid reflux than a heart attack.\n\n" + DISCLAIMER

    result = scan_ai_response(response)

    assert result.verdict == SafetyResult.PASS
    assert result.modified_response == response


@pytest.mark.parametrize(
    "response",
    [
        "You could take paracetamol for the fever.",
        "Try an antacid after dinner.",
        "Take 500 mg twice a day.",
    ],
)
def test_medicine_suggestions_get_no_prescription_note(response):
    result = scan_ai_response(response)

    assert result.verdict == SafetyResult.FLAG
    assert NO_PRESCRIPTION_NOTE in result.modified_response
    assert DISCLAIMER in result.modified_response


def test_lab_values_are_not_mistaken_for_doses():
    response = "Your LDL of 130 mg/dL was above range in March.\n\n" + DISCLAIMER

    result = scan_ai_response(response)

    assert result.verdict == SafetyResult.PASS


def test_escalation_override_prioritizes_user_emergency():
    result = apply_escalation_override(
        "I passed out at work",
        "One possible explanation is low blood sugar.",
    )

    assert result.verdict == SafetyResult.BLOCK
    assert result.modified_response == ESCALATION_MESSAGE


def test_escalation_override_scans_ai_response_when_user_passes():
    result = apply_escalation_override(
        "I feel tired",
        "You have anemia.",
    )

    assert result.verdict == SafetyResult.FLAG
    assert result.modified_response is not None
    assert DISCLAIMER in result.modified_response


def test_pattern_lists_are_not_empty():
    assert EMERGENCY_PATTERNS
    assert DIAGNOSIS_PATTERNS
