# Airport Charges KPI Demo -- Presentation Script

## Overview

This script guides a presenter through the full KPI compliance dashboard demo
for an airport ground-handling contract (`airport-charges-2025.pdf`).
Each step is written in the format:

```
:: EVENT : WHAT TO SPEAK : WHAT TO SHOW
```

---

## PHASE 0 -- Project Dashboard Before & After

### Step 0.1: Show the dashboard baseline before contract ingestion
:: ACTION : "Before adding this contract, I'll show the project's existing portfolio baseline." : Open the project Dashboard tab before uploading or extracting the airport contract.
:: SPEAK : "This is the project's existing obligation portfolio. The dashboard already contains historical and portfolio-level data; the airport contract has not been added yet." : Show the dashboard cards and charts before the airport contract is processed.
:: VERIFICATION : "The baseline dashboard shows the existing obligation count, compliance rate, breach count, current exposure, and client/supplier split. The charts contain the existing portfolio data only." : Point to the summary cards and the current charts.

### Step 0.2: Return to the dashboard after tracking is complete
:: ACTION : "Now that the airport contract is ingested, its obligations are tracked, and the four sources have been linked, I'll return to the project Dashboard." : Click the Dashboard tab after Step 2.7.
:: SPEAK : "The dashboard keeps the existing portfolio and adds the airport contract as a live project contribution. It does not replace the prior data." : Show the updated dashboard.
:: VERIFICATION : "The total obligations increase by the airport contract's 19 extracted KPIs. The current exposure includes the existing portfolio exposure plus the airport contract's open penalty exposure. The compliance and breach totals also include the newly tracked airport obligations." : Compare the pre-ingestion and post-tracking cards.
:: SPEAK : "The charts retain the existing portfolio series and append a 'Live project' point for the newly ingested contract. Source labels remain human-readable, such as CSV Upload, REST API, SAP S/4HANA, and JSON Feed." : Point to the Compliance Health Trend, source chart, and financial exposure chart.
:: VERIFICATION : "The post-tracking dashboard visibly shows the airport contract contribution without losing the pre-existing project data." : Capture the post-tracking dashboard state for the pitch.
:: NOTE : "The airport contract is denominated in SEK. The dashboard keeps the existing portfolio exposure in dollars and shows the airport contract's current exposure separately in SEK, so the currencies are never incorrectly added together." : Point to the `$ At Risk` and `SEK At Risk` cards.

---

## PHASE 1 -- Contract Upload & KPI Extraction

### Step 1.1: Open any account & project
:: ACTION : "I'll open any random account and navigate to an existing project." : Click into the dashboard → select any project.
:: VERIFICATION : "The project workspace loads with an 'Upload Contract' button." : Show the project home page with upload CTA.

### Step 1.2: Upload the contract PDF
:: ACTION : "Now I'll upload the airport-charges-2025.pdf file. The filename is what triggers the demo -- any contract named exactly 'airport-charges-2025.pdf' will get deterministic ground-truth data." : Drag & drop `airport-charges-2025.pdf` into the upload area.
:: SPEAK : "The backend sanitizes the filename and stores the contract. Ingestion runs automatically." : Show upload progress → contract appears in the project list.
:: VERIFICATION : "The contract appears with status 'Ingested' after a few seconds." : Show contract card in the project view.

### Step 1.3: Navigate to the KPI dashboard
:: ACTION : "Opening the KPI workspace from the contract detail page." : Click the contract → "KPI Compliance" tab.
:: SPEAK : "This is the KPI compliance workspace. It has tabs for Intelligence, Review, Heatmap, Sources, Flags, Logs, and Recoveries." : Show the sidebar navigation with all panel tabs.
:: VERIFICATION : "The page loads with the Review panel showing 'Extracting...' or a 'Extract Obligations' button." : Show the KPI dashboard header.

### Step 1.4: Extract KPIs
:: ACTION : "Clicking 'Extract Obligations' to run the deterministic demo extraction." : Click the Extract button.
:: SPEAK : "Behind the scenes, the backend detects the filename `airport-charges-2025.pdf` and routes to the `AirportChargesDemoBuilder` instead of the normal AI extraction path. It returns 19 KPIs -- 10 tracked, 9 recommended." : Wait for the extraction to complete.
:: VERIFICATION : "The panel shows 19 KPIs: 10 in the 'Tracked' bucket, 9 in 'Recommended'. The headline strip shows KPI Coverage 10/19." : Show the KPI dashboard with populated cards.
:: SIDEBAR : "Extraction also seeds 4 reusable integration profiles (CSV, JSON, REST, SAP) for this account. They appear in the Sources panel under Recent Connections -- the user links them manually." : Navigate to the Sources panel briefly → return to Review.

### Step 1.5: Accept all KPIs
:: ACTION : "Accepting all recommended KPIs to bring them into the tracked register." : Click "Accept All Recommended" button.
:: SPEAK : "In a normal contract, the AI would propose KPIs based on clause analysis. Here we accept all 10 tracked + 9 recommended = 19 active KPIs." : Wait for the accept action to complete.
:: VERIFICATION : "The headline strip now shows 19 tracked KPIs with full coverage." : Show the updated KPI count.

---

## PHASE 2 -- Source Linking & Actuals Ingestion

### Step 2.1: Open the Sources panel
:: ACTION : "Switching to the Sources panel to link data sources." : Click "Sources" in the sidebar.
:: SPEAK : "Extraction did NOT auto-create any source configs. Instead, it seeded 4 reusable integration profiles that appear under Recent Connections. 'Your sources' is still empty -- the user adds them explicitly." : Show the empty "Your sources" sidebar.
:: VERIFICATION : "'Your sources' shows 0 sources. The Recent Connections section shows 4 profile cards." : Highlight both sections.

### Step 2.2: Use All profiles from Recent Connections
:: ACTION : "Clicking 'Use All (4)' to create source configs from the seeded profiles." : Click the "Use All" button in Recent Connections.
:: SPEAK : "Each profile carries a sample payload and field mappings. 'Use All' creates the 4 source configs -- Airport Operations CSV, Airport Charges JSON, Ground Handling REST Feed, and SAP S/4HANA Ground Operations." : Watch the cards create the configs.
:: VERIFICATION : "'Your sources' now lists all 4 sources, each showing '0 matched' and status 'ready'." : Point to the 4 sources in the sidebar.

### Step 2.3: Upload a CSV file
:: ACTION : "Selecting the CSV source and clicking 'Upload files'." : Click "Airport Operations CSV" → click "Upload files" button (left of "Preview & test").
:: SPEAK : "The upload parses the file and auto-maps the schema. For demo contracts the preview is populated with the deterministic sample payload." : Pick a CSV file → watch the preview table fill in.
:: VERIFICATION : "Preview table shows columns: kpi_code, kpi_name, actual_value, timestamp, event_id, unit, period, etc. 8 preview rows visible." : Point to the preview grid.

### Step 2.4: Upload a JSON file
:: ACTION : "Selecting the JSON source and clicking 'Upload files'." : Click "Airport Charges JSON" → click "Upload files".
:: SPEAK : "Same process for JSON -- the system parses the structure and shows the seeded preview rows." : Pick a JSON file → watch the preview.
:: VERIFICATION : "Preview shows measurement, recorded_at, record_id fields instead of actual_value/timestamp. Source type stays 'JSON' -- the upload preserves it." : Compare CSV vs JSON preview side by side.

### Step 2.5: Smart Match the CSV source
:: ACTION : "Clicking 'Smart Match' on the CSV source." : Click the "Smart Match" button.
:: SPEAK : "Smart Match reads the sample payload's kpi_code field, links the matching KPIs, and ingests the actuals in one click. For demo contracts this creates actuals AND breaches for the breached KPIs -- landing, passenger, and parking." : Wait for matching + ingestion to complete.
:: VERIFICATION : "The source shows '3 matched' and the 'Linked' pill appears in the sidebar. Step advances to 'Ingest' with the run result." : Show sidebar pill + ingest step.

### Step 2.6: Smart Match the JSON source
:: ACTION : "Selecting the JSON source and clicking 'Smart Match'." : Click "Airport Charges JSON" → click "Smart Match".
:: SPEAK : "Same behavior -- actuals and one breach (Passenger Services) get created for this source." : Wait.
:: VERIFICATION : "JSON source shows '1 matched' and the 'Linked' pill." : Show the result.

### Step 2.7: Smart Match the remaining sources
:: ACTION : "Running Smart Match on the REST and SAP sources." : Click the REST source → "Smart Match" → then SAP source → "Smart Match".
:: SPEAK : "Now linking the Ground Handling REST Feed (Electricity + De-icing breaches) and SAP S/4HANA (Extra Hours breach). After all 4 sources are linked, the flags panel shows 6 breaches." : Wait for both.
:: VERIFICATION : "All 4 sources show 'Linked' pill. Flags count in the header badge updates to 6." : Navigate to Flags panel briefly.

### Step 2.8: Show the post-tracking project dashboard
:: ACTION : "The contract is now fully tracked, so I'll show how it has been added to the project-level dashboard." : Click the Dashboard tab.
:: SPEAK : "The dashboard now combines the existing portfolio with the airport contract: 19 airport obligations, linked-source actuals, open breaches, and penalty exposure are included in the project view." : Show the updated dashboard cards.
:: VERIFICATION : "The dashboard shows the additive totals, the airport contract's current exposure, a 'Live project' trend point, and readable source labels. Existing dashboard data remains visible alongside the new contract data." : Point to the Total Obligations, Active Breaches, $ At Risk, Compliance Health Trend, and Breaches detected via Sources cards.

---

## PHASE 3 -- Flags & Escalation

### Step 3.1: Open Flags panel
:: ACTION : "Navigating to the Flags panel to review breaches." : Click "Flags" tab.
:: SPEAK : "The flags panel shows 6 open breaches across the 10 tracked KPIs. Let me walk through the status." : Show the panel.
:: VERIFICATION : "6 flags displayed with De-icing as Critical and the remaining breaches as High." : Point to each flag's severity badge.

### Step 3.2: Show the breach detail row
:: ACTION : "Expanding a breach row to see full detail." : Click the "Details" chevron on the first breach.
:: SPEAK : "Here you can see the KPI, the expected vs actual values, variance, penalty exposure, and the remedy text." : Expand the row.
:: VERIFICATION : "Expanded row shows: Metric detail, Remedy tile (full text visible), SLA tile, Expected vs Actual, Variance, Data source, Flagged escalation email, and Follow-up actions section." : Walk through each DetailTile in the expanded view.
:: NOTE : "The remedy text now displays fully without truncation -- the DetailTile uses `whitespace-normal` instead of `truncate`." : Point to the remedy text.

### Step 3.3: Send escalation email
:: ACTION : "Clicking the 'Escalate' button to send an escalation email to the carrier." : Click the Escalate button (Mail icon).
:: SPEAK : "This opens the Escalation Alert Email modal. The recipient was resolved from the contract parties. The email body is auto-generated with KPI details, penalty exposure, required action, and clause reference." : Show the modal.
:: VERIFICATION : "Modal shows: To field with email, Recipient Source, Subject line with KPI name + severity, and an editable body textarea with full email text." : Walk through the modal fields.
:: NOTE : "The textarea is now taller (min-h-[320px]) and the remedy text in the body is fully visible." : Point to the textarea.

### Step 3.4: Dispatch the alert
:: ACTION : "Clicking 'Dispatch Alert' to send the email." : Click the Dispatch button.
:: SPEAK : "In this demo environment, no real email is sent. The dispatch is recorded as 'mock_dispatched' status. The breach status transitions to 'in_action'." : Click dispatch.
:: VERIFICATION : "Toast notification: 'Escalation logged -- Recorded in demo mode as mock_dispatched; no external email was sent.'" : Show the toast. Then point to the status badge changing from 'open' (red) to 'in_action' (blue).
:: NOTE : "The status badge now shows 'In Action' in blue, thanks to the statusTone addition for the `in_action` state." : Point to the badge.

### Step 3.5: Verify status change in Flags panel
:: ACTION : "Refreshing the Flags panel to see the updated status." : Navigate away and back, or check the status badge in-place.
:: SPEAK : "The breach we just escalated now shows 'In Action' status instead of 'Open'." : Show the updated badge.
:: VERIFICATION : "One flag now shows 'In Action' (blue), the remaining 6 still show 'Open' (red)." : Point to the first flag's status badge vs. the others.

---

## PHASE 4 -- Recoveries Management

### Step 4.1: Open Recoveries panel
:: ACTION : "Switching to the Recoveries Management panel." : Click "Recoveries" tab.
:: SPEAK : "This panel shows all open recoveries -- breaches that haven't been resolved yet. They're sorted by severity (Critical first)." : Show the panel.
:: VERIFICATION : "7 recovery cards visible. The one we escalated shows 'In Action' status. Others still show 'Open'." : Point to the escalated one vs. the rest.

### Step 4.2: Show Recovery Pipeline chart
:: ACTION : "Looking at the Financial Exposure section showing the Recovery Pipeline chart." : Scroll to the recovery pipeline section.
:: SPEAK : "The Recovery Pipeline chart shows the distribution of breaches by status: Open, In Action, Acknowledged, Reminded, Escalated, Resolved." : Point to each bar.
:: VERIFICATION : "Bar chart shows: 6 Open, 1 In Action, 0 Acknowledged, etc. The 'In Action' bar is blue and distinct from the red 'Open' bars." : Point to the In Action bar.

### Step 4.3: Show Breaches by Category chart
:: ACTION : "Looking at the Breaches by Category section." : Scroll to the category chart.
:: SPEAK : "This chart groups breaches by KPI category -- ground_handling, passenger, security, de_icing, catering, maintenance. The dot color indicates if any breach in that category is critical (red), high (orange), or other (blue)." : Point to each category bar.
:: VERIFICATION : "Category bars: ground_handling (2), passenger (2), security (1), de_icing (1), catering (1). Red dot on ground_handling and security (critical severity)." : Point to specific categories and their dot colors.
:: NOTE : "The 'Remind client' button that was below the Details button in the collapsed row has been removed. Follow-up actions are now handled through the Escalation Email flow." : Point to the action buttons.

### Step 4.4: Expand a recovery to show details
:: ACTION : "Expanding a recovery row to see its detail tiles and follow-up actions." : Click the Details chevron on a row.
:: SPEAL : "The expanded view shows the full breach detail: metric, remedy, SLA, expected vs actual, variance, data source, flagged escalation email, and trigger." : Expand the row.
:: VERIFICATION : "Detail tiles visible with full remedy text, no truncation. Follow-up actions section shows previous dispatch history." : Walk through the tiles.
:: NOTE : "The Remedy DetailTile now uses `whitespace-normal` and `break-words` so long remedy text wraps fully instead of being single-line truncated." : Point to the remedy text.

### Step 4.5: Send a follow-up email from recoveries
:: ACTION : "Clicking 'Send Escalation Alert Email' on a recovery row." : Click the Escalate button in the expanded row.
:: SPEAK : "This opens the same email modal as in the Flags panel. For a follow-up, the body could be edited to note the previous escalation." : Show the modal.
:: VERIFICATION : "Modal opens with pre-filled body. The user edits and dispatches." : Demonstrate editing and dispatching.
:: NOTE : "After dispatch, the breach status remains 'in_action' (already escalated), and a new entry appears in the Follow-up actions list." : Show the follow-up list updating.

---

## PHASE 5 -- Heatmap & Coverage Analysis

### Step 5.1: Open Heatmap panel
:: ACTION : "Navigating to the KPI Heatmap panel." : Click "Heatmap" tab.
:: SPEAK : "The heatmap gives a visual overview of compliance coverage across IATA service categories." : Show the panel.
:: VERIFICATION : "Four summary cards at top: Tracked Clear, Active Breaches, Accepted, Deferred." : Point to the cards.

### Step 5.2: Coverage by Service Category
:: ACTION : "Looking at the Coverage by Service Category chart." : Point to the chart.
:: SPEAK : "This chart now appears ABOVE the KPI Tracking Matrix. It shows KPI obligation density per IATA operational service area -- how many KPIs are tracked vs. breached in each category." : Point to each category bar.
:: VERIFICATION : "Category bars: Ground Handling (3 tracked, 2 breaches, red bar), Passenger (2 tracked, 1 breach, red), Security (2 tracked, 1 breach, red), Catering (1 tracked, 0 breaches, green), De-icing (1 tracked, 1 breach, red), Maintenance (1 tracked, 0 breaches, green)." : Point to each bar and its color.

### Step 5.3: KPI Tracking Matrix
:: ACTION : "Scrolling down to the KPI Tracking Matrix." : Scroll.
:: SPEAK : "Each row is a tracked KPI, each column is an IATA service category. The colored dot shows compliance status: tracked (clear), tracked (breach), accepted, deferred, or ignored." : Point to rows and dots.
:: VERIFICATION : "19 rows visible. Dots in the correct category column per KPI. Breach dots are red, clear dots are emerald." : Point to a few specific KPI/category intersections.

### Step 5.4: Legend
:: ACTION : "Reading the legend at the bottom." : Point to the legend.
:: SPEAK : "The legend explains each dot color: Tracked / Clear (emerald), Tracked / Breach (red), Accepted (blue), Deferred (gray), Ignored." : Point to each legend item.
:: VERIFICATION : "Five legend items visible with color dots." : Confirm each.

---

## PHASE 6 -- Financial Exposure

### Step 6.1: Open Flags panel → Financial Exposure section
:: ACTION : "Scrolling to the Financial Exposure section in the Flags panel." : Navigate to Flags → scroll down.
:: SPEAK : "This section shows the penalty exposure by KPI, calculated from breach counts and per-unit rates." : Point to the chart.
:: VERIFICATION : "Penalty Exposure chart shows bars for Landing Charge (~4,268 SEK), Passenger Services (~3,543 SEK), Electricity (~119 SEK), etc." : Point to each bar.

### Step 6.2: Show Breach Severity Mix (now Breaches by Category)
:: ACTION : "Looking at the Breaches by Category chart in this section." : Point to the chart.
:: SPEAK : "Previously this was a 'Breach Severity Mix' pie chart. Now it's a horizontal bar chart grouped by KPI category with color-coded dots showing worst severity per category." : Point to each bar.
:: VERIFICATION : "Horizontal bars for: ground_handling (red dot), passenger (red dot), de_icing (orange dot), security (red dot), catering (blue dot), maintenance (blue dot)." : Point to each.

### Step 6.3: Show Recovery Pipeline chart
:: ACTION : "Looking at the Recoveries Pipeline chart in this section." : Point to the chart.
:: SPEAK : "Status distribution: 6 Open (red), 1 In Action (blue), 0 Acknowledged, 0 Reminded, 0 Escalated, 0 Resolved." : Point to each bar.
:: VERIFICATION : "Bar chart with 6 colored bars matching the RecoveryPipelineChart rows." : Confirm.

### Step 6.4: Show Turnaround & Landing charts
:: ACTION : "Looking at the Contract Rate Reference section." : Scroll further.
:: SPEAK : "These charts show the contract's rate cards for turnaround charges, landing charges, and per-occasion fees." : Point to each chart.
:: VERIFICATION : "Three charts: Turnaround Charge by Seat Band (200px height bars), Landing Charge vs MTOW (curve with annotation), Per-Occasion Charges (ranked horizontal bars with h-3 thickness)." : Point to each.

---

## END OF DEMO

## Key Architecture Points to Highlight

- **Filename detection**: Any contract named `airport-charges-2025.pdf` triggers the demo. No special account or contract ID needed.
- **No AI involved**: The extraction uses deterministic ground-truth data, not a real LLM extraction.
- **Staged data**: KPIs appear on extraction → integration profiles appear in Recent Connections → the user clicks "Use All" to create source configs → actuals+flags appear when each source is "Preview & test"ed.
- **No real emails**: All dispatches are recorded as "mock_dispatched" -- no external email delivery.
- **All 4 sources**: CSV, JSON, REST API, SAP S/4HANA each contribute specific KPIs with deterministic breaches.
```
