# VitaSense AI — UI/UX Specification Document

> **Document Type:** Frontend Design & Flow Specification
> **Project:** VitaSense AI — Personalized Preventive Healthcare Assistant
> **Scope:** Complete website flow, page layouts, interactions, and data parameters

---

## Table of Contents

1. [Overall Design Philosophy](#1-overall-design-philosophy)
2. [Site Map & Navigation Flow](#2-site-map--navigation-flow)
3. [Page 1 — Login Page](#3-page-1--login-page)
4. [Page 2 — New User Onboarding (Enter User Data)](#4-page-2--new-user-onboarding-enter-user-data)
5. [Page 3 — Home Page (Post Login)](#5-page-3--home-page-post-login)
6. [Page 4 — Daily Routine (Monthly Calendar Tracker)](#6-page-4--daily-routine-monthly-calendar-tracker)
7. [Page 5 — Chatbot Page](#7-page-5--chatbot-page)
8. [Page 6 — Profile Page](#8-page-6--profile-page)
9. [Global UI Components](#9-global-ui-components)
10. [Interaction Rules & Constraints](#10-interaction-rules--constraints)

---

## 1. Overall Design Philosophy

### Visual Identity

| Attribute | Direction |
|---|---|
| Tone | Clean, calm, medical-grade yet warm |
| Style | Minimal with purposeful colour use |
| Typography | Sans-serif, well-spaced, readable |
| Colour Palette | Soft white background, teal/green primary, warm grey neutrals, coral for alerts |
| Spacing | Generous padding, nothing feels cramped |
| Buttons | Rounded corners, consistent sizing, clear hierarchy |
| Animations | Subtle transitions — no jarring movements |
| Mobile | Fully responsive across screen sizes |

### Design Principles

- Every page should feel intentional — no clutter
- The user should always know where they are and what to do next
- Health data entry should feel effortless, not clinical
- Emotional sections must feel safe and human, not interrogative
- Feedback messages (success, error) must be immediate and reassuring

---

## 2. Site Map & Navigation Flow

```
Landing / Login Page
│
├── New User
│   ├── Home Page (Welcome + Navbar)
│   │   └── Enter User Data Button
│   │       └── 5-Section Onboarding Form
│   │           └── "Profile Added Successfully" → redirect to Daily Routine
│   │
│   ├── Daily Routine Page (Monthly Calendar)
│   │   └── Click Present Date → Daily Log Popup
│   │       └── Submit → "Daily Activity Updated Successfully"
│   │
│   ├── Chatbot Page
│   │   └── AI Chat Interface
│   │
│   └── Profile Page
│       └── View / Edit onboarding data
│
└── Old User
    └── Home Page (Welcome + Navbar) → Daily Routine Calendar (direct)
        ├── Daily Routine Page
        ├── Chatbot Page
        └── Profile Page (pre-filled)
```

---

## 3. Page 1 — Login Page

### Layout

- Full-screen centered layout
- VitaSense AI logo + tagline at the top center
- Tagline: *"Your personalized preventive healthcare companion"*
- Two large, distinct buttons below

### Buttons

| Button | Label | Action |
|---|---|---|
| Primary | **New User** | Triggers new user registration flow → navigates to Home Page |
| Secondary | **Old User** | Triggers authentication → navigates directly to Daily Routine Calendar |

### Old User Authentication

- On clicking **Old User**: display a simple login form (email + password or OTP)
- On successful login: skip onboarding entirely, go straight to the Monthly Calendar page with a personalized welcome greeting

### Design Notes

- Background: soft gradient (white to very light teal)
- Buttons: large, pill-shaped, well-spaced — not stacked too close
- The two buttons should have visual contrast (filled vs outlined) to indicate hierarchy
- Subtle logo animation on load (fade in)

---

## 4. Page 2 — New User Onboarding (Enter User Data)

### Entry Point

Accessed by clicking the **Enter User Data** button on the Home Page (only shown to new users who have not yet submitted their profile).

### Layout

- Full-page scrollable form
- Sectioned with clear headings and section numbers
- Progress indicator at the top (Step 1 of 5, Step 2 of 5, etc.) or visible section tabs
- Each section visually separated with a soft divider
- **Submit button** fixed at the bottom of the final section

---

### Section 1 — Life Context

> *Defines the user's real-world living reality and routine structure.*

| UI Question | DB Parameter | Input Type | Options |
|---|---|---|---|
| What best describes your current life phase? | `life_phase` | Single Select (ENUM) | Student Life, Early Career, High-Pressure Work Life, Transition Phase, Family-Focused Life, Irregular Lifestyle |
| Who do you usually spend most of your daily life around? | `social_environment` | Single Select (ENUM) | Family, Friends/Roommates, Mostly Alone, Hostel Community, Coworkers/Classmates, Mixed |
| What usually affects your health the most in daily life? | `perceived_health_triggers` | Multi Select (ARRAY) | Open tag-style multi-select |
| How predictable is your daily life? | `life_structure_type` | Single Select (ENUM) | Very Structured, Mostly Structured, Mixed, Mostly Unpredictable, Completely Unpredictable |
| What best describes your lifestyle overall? | `lifestyle_identity` | Single Select (ENUM) | Health Conscious, Balanced, Stress-Driven, Highly Busy, Physically Active, Mentally Exhausted, Irregular Lifestyle |
| What kind of environment do you feel healthiest in? | `preferred_environment` | Single Select (ENUM) | Cold Climate, Warm Climate, Dry Climate, Nature/Outdoors, Indoor Controlled Environment, No Specific Preference |

---

### Section 2 — Food & Body Relationship

> *Captures relationship with food and body — not calorie counts or measurements.*

| UI Question | DB Parameter | Input Type | Options |
|---|---|---|---|
| Which best describes your eating pattern? | `eating_behavior` | Single Select (ENUM) | Disciplined, Emotional Eating, Irregular Eating, Convenience-Based, Late-Night Eating, Stress-Based Eating |
| What usually causes unhealthy eating for you? | `unhealthy_eating_triggers` | Multi Select (ARRAY) | Stress, Workload, Exams, Travel, Social Events, Loneliness, Lack of Time, Mood Swings |
| How connected do you feel with your body's health signals? | `body_awareness_level` | Single Select (ENUM) | Very Aware, Somewhat Aware, Rarely Notice, Not Aware |
| Do stress or emotions affect your eating or sleep? | `emotional_health_impact` | Toggle (BOOLEAN) | Yes / No |

---

### Section 3 — Medical & Health Identity

> *Establishes long-term biological and medical context.*

| UI Question | DB Parameter | Input Type |
|---|---|---|
| Do you have any long-term health conditions? | `chronic_conditions` | Multi Select / Free tag (ARRAY) |
| Any recurring health problems you frequently experience? | `recurring_health_patterns` | Multi Select (ARRAY) |
| Any known allergies or sensitivities? | `allergy_conditions` | Multi Select / Free tag (ARRAY) |
| Any major surgeries or medical events in the past? | `major_medical_history` | Multi Select / Free tag (ARRAY) |
| Anything important about your health history you'd like the system to know? | `personal_health_note` | Long text area (TEXT) |

**Recurring Health Pattern Options:**
Frequent Headaches, Acidity, Low Energy, Sleep Issues, Throat Problems, Body Pain, Stress Fatigue, Recurring Fever, Digestive Problems

---

### Section 4 — Emotional & Mental Wellness

> ⚠️ **This section is fully optional.** The UI must clearly communicate: *"This section is optional and completely safe. Your responses are private and used only to improve your health insights."*

| UI Question | DB Parameter | Input Type | Options |
|---|---|---|---|
| Would you like emotional wellness insights enabled? | `emotional_tracking_enabled` | Toggle (BOOLEAN) | Yes / No — if No, rest of section collapses |
| What currently affects your mental wellness the most? | `emotional_pressure_sources` | Multi Select (ARRAY) | Exams, Career Pressure, Burnout, Loneliness, Relationships, Family Pressure, Financial Stress, Loss/Grief, Overthinking |
| When stressed, what usually gets affected first? | `stress_response_pattern` | Single Select (ENUM) | Sleep, Appetite, Energy Levels, Mood, Focus, Physical Symptoms, Everything |
| What kind of support helps you recover best? | `recovery_preference` | Single Select (ENUM) | Rest, Talking to Someone, Isolation, Exercise, Entertainment, Sleep, Food, Nature/Travel |

---

### Section 5 — Personal Human Context

> *The most important section. This is where VitaSense becomes emotionally intelligent.*

**Single open-ended question displayed prominently:**

> *"Is there anything about your lifestyle, personality, habits, emotional state, or health that you feel the system should understand to support you better?"*

| DB Parameter | Input Type |
|---|---|
| `personal_context_summary` | Large, open text area — no character limit |

**UI Notes for this section:**
- Display this question in a larger, warmer font
- Placeholder text: *"Write freely. This helps us understand you as a person, not just a patient."*
- No mandatory field indicator — completely optional
- Soft, encouraging tone throughout

---

### Form Submission

- On clicking **Submit**:
  - Validate required fields (Sections 1–3 minimum)
  - Show a full-screen or overlay success message:

```
✅ Profile Added Successfully
Welcome to VitaSense AI. Your health journey starts today.
```

  - After 2 seconds, automatically redirect to the **Daily Routine Calendar Page**

---

## 5. Page 3 — Home Page (Post Login)

### Layout

- Top: VitaSense AI logo (top left) + **Logout** button (top right)
- Center greeting area:
  - **"Good morning, [Name]"** (or afternoon/evening based on time)
  - Present **Day and Date** displayed prominently below the greeting (e.g., *Thursday, 14 May 2026*)
- Horizontal **Navigation Bar** below the greeting

### Navigation Bar

Three equally spaced tabs, centered horizontally:

| Tab | Label | Navigates To |
|---|---|---|
| 1 | **Profile** | Profile Page |
| 2 | **Daily Routine** | Monthly Calendar Tracker |
| 3 | **Chatbot** | AI Chat Interface |

Active tab should have a visible indicator (underline or filled pill style).

### New User — Additional Element

Below the navigation bar, display a prominent **Enter User Data** button:

- Large, centered, primary-coloured button
- Label: **"Enter User Data"**
- Subtext below button: *"Complete your health profile to get personalized insights"*
- This button disappears once the user has submitted their onboarding form

---

## 6. Page 4 — Daily Routine (Monthly Calendar Tracker)

### Page Layout

- Page title: **"Daily Routine"** (top left, below navbar)
- Calendar occupies **3/4 of the page width**, centered horizontally
- Balanced whitespace on both sides — not edge-to-edge, not too small
- Month navigation arrows (← Previous / Next →) at the top of the calendar
- Current month and year displayed between the arrows

### Calendar Design

| Element | Specification |
|---|---|
| Grid | 7 columns (Mon–Sun), standard month grid |
| Cell size | Well-spaced — not cramped, not oversized |
| Today's date | Highlighted with primary teal colour ring or filled background |
| Past dates with data logged | Show a small green dot indicator below the date number |
| Past dates without data | No indicator |
| Future dates | Greyed out, visually muted |

### Date Click Behaviour

#### Clicking the Present Date (Today)
- Opens a **popup / modal overlay** with the calendar visible in the background (blurred or dimmed)
- Popup contains the full daily log form (all sections below)
- If data was already submitted today: show existing data pre-filled and allow editing until 23:59
- Submit button at the bottom of the popup

#### Clicking a Past Date
- Opens the same popup in **read-only mode**
- All fields display the submitted data
- No edit capability — fields are locked
- A label at the top of the popup: *"Data for [Date] — Read Only"*
- Close button only (no Submit)

#### Clicking a Future Date
- No popup opens
- A small inline tooltip appears: *"You can only log data for today or view past entries."*

---

### Daily Log Popup — Parameters

#### Section 1 — Food & Consumption Memory

| Frontend Question | Parameter | Input Type |
|---|---|---|
| What did you have for breakfast today? | `breakfast_log` | Text area |
| What did you have for lunch today? | `lunch_log` | Text area |
| What did you have for dinner today? | `dinner_log` | Text area |
| Any snacks or beverages today? | `snacks_beverages_log` | Text area |
| Did you try food from a new place today? | `ate_from_new_place` | Toggle (Yes/No) |
| Did you consume packaged/frozen/processed food today? | `processed_food_consumed` | Toggle (Yes/No) |
| Any unusual food exposure today? | `unusual_food_exposure` | Text area |
| Were you exposed to anything unusual today? | `unusual_exposure_notes` | Text area |

---

#### Section 2 — Body & Daily Health Feeling

| Frontend Question | Parameter | Input Type | Options |
|---|---|---|---|
| How was your energy level today? | `energy_level` | Single Select (ENUM) | Very High, High, Moderate, Low, Very Low |
| How was your mood today? | `mood_today` | Single Select (ENUM) | Great, Good, Neutral, Anxious, Sad, Irritable, Exhausted |
| How do you feel about your overall health today? | `overall_health_feeling` | Single Select (ENUM) | Very Good, Good, Okay, Unwell, Very Unwell |
| Did stress or emotions affect you physically today? | `emotional_physical_impact` | Toggle (Yes/No) | — |
| Any physical discomfort today? | `physical_discomfort_notes` | Text area | — |
| Anything unusual you noticed in your body today? | `unusual_body_observation` | Text area | — |

---

#### Section 3 — Daily Life & Exposure Events

| Frontend Question | Parameter | Input Type | Options |
|---|---|---|---|
| Any important events today? | `daily_events` | Multi-tag text input (TEXT[]) | Free entry |
| How intense was your workload today? | `workload_intensity` | Single Select (ENUM) | Very Low, Low, Moderate, High, Very High, Overwhelming |
| Were you exposed to crowded places today? | `crowded_place_exposure` | Toggle (Yes/No) | — |
| Did you travel today? | `travel_today` | Toggle (Yes/No) | — |
| Was your sleep schedule disturbed today? | `sleep_schedule_disruption` | Toggle (Yes/No) | — |
| Any emotionally significant event today? | `emotional_event_note` | Text area | — |

---

#### Section 4A — AI Health Assistant Memory

> *Auto-populated by the chatbot. Read-only in the daily log popup. Shown as a summary card if chatbot was used today.*

| Field | Parameter | Source |
|---|---|---|
| Symptoms discussed with chatbot | `chatbot_symptoms_reported` | Auto — Chatbot |
| Severity level identified | `chatbot_symptom_severity` | Auto — Chatbot |
| Possible causes generated | `chatbot_possible_causes` | Auto — Chatbot |
| AI health summary | `chatbot_health_assistant_note` | Auto — Chatbot |
| AI recommended action | `chatbot_recommended_action` | Auto — Chatbot |
| AI risk level | `chatbot_risk_level` | Auto — Chatbot |
| AI follow-up questions | `chatbot_followup_questions` | Auto — Chatbot |
| Chatbot session summary | `chatbot_session_summary` | Auto — Chatbot |

---

#### Section 4B — Real Medical Events

| Frontend Question | Parameter | Input Type |
|---|---|---|
| Did you consult a doctor today? | `doctor_consulted_today` | Toggle (Yes/No) |
| Why did you visit the doctor? | `medical_visit_reason` | Text area |
| What was the outcome/diagnosis from the visit? | `doctor_outcome_summary` | Text area |
| Did you upload any medical report today? | `medical_report_uploaded` | Toggle + File upload |
| Linked uploaded medical reports | `linked_medical_reports` | File reference list |
| Current recovery status | `recovery_status` | Single Select (ENUM): Healthy / Recovering / Unwell / Under Observation |

---

#### Section 5 — User Free Memory Notes

| Frontend Question | Parameter | Input Type |
|---|---|---|
| Anything important about today you want the system to remember? | `daily_free_notes` | Large open text area |

---

### Popup Submission

- **Submit button** fixed at the bottom of the popup, full width
- On click: validate and save data
- Display inline success message inside the popup:

```
✅ Daily Activity Updated Successfully
```

- Popup closes after 1.5 seconds
- The calendar date cell updates to show the green dot indicator

---

## 7. Page 5 — Chatbot Page

### Layout

- Full-height chat interface, similar to a messaging app
- Header: **"VitaSense AI Assistant"** with a small health/pulse icon
- Subheader: *"Describe how you're feeling and I'll help you understand it."*
- Chat window: scrollable message area (80% of page height)
- Input bar: fixed at the bottom — text field + send button

### Chat Behaviour

- AI responds in conversational, warm, non-clinical tone
- AI asks follow-up questions dynamically based on user responses
- Responses include:
  - Possible causes (probability-framed)
  - Reasoning trail (which lifestyle factors contributed)
  - Risk classification (Low / Medium / High)
  - Recommended actions
- Emergency keywords trigger an immediate full-screen alert with hospital referral info
- At the end of each session, the chatbot generates a session summary that is automatically saved to the current day's log (Section 4A)

### Design Notes

- User messages: right-aligned, teal bubble
- AI messages: left-aligned, white/light grey bubble
- Typing indicator (animated dots) while AI is generating a response
- Timestamps on each message
- Smooth scroll to latest message

---

## 8. Page 6 — Profile Page

### Layout

- Displays all data submitted during onboarding (Sections 1–5)
- Organized in the same section structure as the onboarding form
- Each section shown as a readable card — not a form

### New User State

- If profile is not yet filled: show the **Enter User Data** button (same as Home Page)

### Old User State

- Profile data is pre-filled and displayed in read-only card format
- An **Edit Profile** button allows the user to update their onboarding data

### Health Record Imports (from finalized parameters)

A dedicated sub-section on the Profile page for uploading health records:

| Record Type | Parameter |
|---|---|
| Blood Reports | `blood_reports` |
| Prescriptions | `prescriptions` |
| BP Reports | `bp_reports` |
| Blood Sugar Values | `blood_sugar_values` |
| Vitamin Deficiencies | `vitamin_deficiencies` |
| Allergy Reports | `allergy_reports` |
| Medication History | `medication_history` |
| Previous Diagnosis Reports | `previous_diagnosis_reports` |

Each record type has an **Upload** button and shows previously uploaded files as a list with date stamps.

---

## 9. Global UI Components

### Top Navigation Bar (All pages after login)

| Element | Position | Behaviour |
|---|---|---|
| VitaSense AI Logo | Top Left | Clicking returns to Home |
| Profile / Daily Routine / Chatbot tabs | Center | Horizontal, equal spacing |
| Logout Button | Top Right | Ends session, returns to Login page |

### Success Messages

| Trigger | Message |
|---|---|
| Profile form submitted | ✅ Profile Added Successfully |
| Daily log submitted | ✅ Daily Activity Updated Successfully |

- Success messages appear as a centered overlay or inline banner
- Green background, white text, checkmark icon
- Auto-dismiss after 2 seconds with redirect (where applicable)

### Error / Validation States

- Required field not filled: red underline + inline hint text
- Future date clicked: tooltip message (no popup)
- Past date clicked: read-only mode label in popup header

---

## 10. Interaction Rules & Constraints

### Calendar Date Rules

| Date Type | Can Open Popup | Can Enter Data | Can Edit Data | Can View Data |
|---|---|---|---|---|
| Today (before 23:59) | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| Today (after 23:59) | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| Past Date | ✅ Yes | ❌ No | ❌ No | ✅ Yes |
| Future Date | ❌ No | ❌ No | ❌ No | ❌ No |

### User Type Rules

| Rule | New User | Old User |
|---|---|---|
| Sees Enter User Data button | ✅ Yes (until submitted) | ❌ No |
| Profile page pre-filled | ❌ No | ✅ Yes |
| Lands on after login | Home Page | Daily Routine Calendar |
| Onboarding form required | ✅ Yes | ❌ No |

### Data Integrity Rules

- Users cannot backfill past daily logs (no data entry for past dates)
- Daily log data for the current day locks at 23:59
- Chatbot session summaries are written automatically — users cannot manually edit Section 4A
- File uploads in health records are append-only (can add, cannot delete without confirmation)

---

*Document version 1.0 — VitaSense AI Hackathon UI/UX Specification*
