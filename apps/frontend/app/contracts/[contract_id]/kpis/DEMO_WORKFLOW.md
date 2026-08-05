# Airport Charges KPI Demo -- Presentation Script

## Overview

This script guides a presenter through the full KPI compliance dashboard demo
for an airport ground-handling contract (`airport-charges-2025.pdf`).
Each step is written in the format:

```
:: EVENT : WHAT TO SPEAK : WHAT TO SHOW
```

---

## PHASE 0 -- Project Dashboard Baseline (Pre-Ingestion)

### Step 0.1: Show the dashboard baseline before contract ingestion
:: ACTION : "Before adding this contract, I'll show the project's existing portfolio baseline." : Open the project Dashboard tab before uploading or extracting the airport contract.
:: SPEAK : "This is the project's existing obligation portfolio. The dashboard already contains historical and portfolio-level data; the airport contract has not been added yet." : Show the dashboard cards and charts before the airport contract is processed.
:: VERIFICATION : "The baseline dashboard shows the existing obligation count, compliance rate, breach count, current exposure, and client/supplier split. The charts contain the existing portfolio data only." : Point to the summary cards and the current charts.


---

## PHASE 1 -- Contract Upload, Extraction & Verification

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
:: VERIFICATION : "The page loads with the Review panel showing 'Extracting...' or an 'Extract Obligations' button." : Show the KPI dashboard header.

### Step 1.4: Extract KPIs
:: ACTION : "Clicking 'Extract Obligations' to run the deterministic demo extraction." : Click the Extract button.
:: SPEAK : "Behind the scenes, the backend detects the filename `airport-charges-2025.pdf` and routes to the `AirportChargesDemoBuilder` instead of the normal AI extraction path. It returns 19 KPIs -- 10 tracked, 9 recommended." : Wait for the extraction to complete.
:: VERIFICATION : "The panel shows 19 KPIs: 10 in the 'Tracked' bucket, 9 in 'Recommended'. The headline strip shows KPI Coverage 10/19." : Show the KPI dashboard with populated cards.
:: SIDEBAR : "Extraction also seeds 4 reusable integration profiles (CSV, JSON, REST, SAP) for this account. They appear in the Sources panel under Recent Connections -- the user links them manually." : Navigate to the Sources panel briefly → return to Review.

### Step 1.5: Accept all KPIs
:: ACTION : "Accepting all recommended KPIs to bring them into the tracked register." : Click "Accept All Recommended" button.
:: SPEAK : "In a normal contract, the AI would propose KPIs based on clause analysis. Here we accept all 10 tracked + 9 recommended = 19 active KPIs." : Wait for the accept action to complete.
:: VERIFICATION : "The headline strip now shows 19 tracked KPIs with full coverage." : Show the updated KPI count.

### Step 1.6: View KPI details & refer contract PDF
:: ACTION : "Clicking on one of the tracked KPIs to view its details and referencing the contract." : Click on KPI ID 'kpi_1' -> Click 'Refer Contract' to jump to the PDF reference.
:: SPEAK : "The KPI details panel shows the KPI name, ID, status, and extraction confidence. Clicking 'Refer Contract' opens the source PDF and highlights the exact contract text from which this KPI was extracted." : Show the KPI details panel and click 'Refer Contract' to display the highlighted PDF clause.
:: VERIFICATION : "The PDF viewer opens with the relevant clause highlighted side-by-side with the KPI details." : Point to the highlighted text in the contract PDF view.

---

## PHASE 2 -- Actual Data Sources & Ingestion

### Step 2.1: Open the Sources panel
:: ACTION : "Switching to the Sources panel to link data sources." : Click "Sources" in the sidebar.
:: SPEAK : "Extraction did NOT auto-create any source configs. Instead, it seeded 4 reusable integration profiles under Recent Connections. 'Your sources' is still empty." : Show the empty "Your sources" section.
:: VERIFICATION : "'Your sources' shows 0 sources. The Recent Connections section shows 4 profile cards." : Highlight both sections.

### Step 2.2: Add all sources using 'Use All'
:: ACTION : "Clicking 'Use All (4)' to create source configs from the seeded profiles." : Click the "Use All" button in Recent Connections.
:: SPEAK : "Each profile carries a sample payload and field mappings. 'Use All' creates the 4 source configs -- Airport Operations CSV, Airport Charges JSON, Ground Handling REST Feed, and SAP S/4HANA Ground Operations." : Watch the cards create the configs.
:: VERIFICATION : "'Your sources' now lists all 4 sources, each showing '0 matched' and status 'ready'." : Point to the 4 sources in the sidebar.

### Step 2.3: Upload CSV in CSV source
:: ACTION : "Selecting the CSV source and uploading a CSV file." : Select "Airport Operations CSV" → click "Upload files" button.
:: SPEAK : "The upload parses the file and auto-maps the schema. For demo contracts the preview is populated with the deterministic sample payload." : Pick a CSV file → watch the preview table fill in.
:: VERIFICATION : "Preview table shows columns: kpi_code, kpi_name, actual_value, timestamp, event_id, unit, period, etc. 8 preview rows visible." : Point to the preview grid.

### Step 2.4: Smart Match the CSV source
:: ACTION : "Clicking 'Smart Match' on the CSV source." : Click the "Smart Match" button for the CSV source.
:: SPEAK : "Smart Match reads the payload fields, links matching KPIs, and ingests actual values. For demo contracts this creates actuals and initial breaches." : Wait for matching + ingestion to complete.
:: VERIFICATION : "CSV source shows '3 matched' and the 'Linked' status pill." : Point to the CSV source pill.

### Step 2.5: Upload JSON in JSON source
:: ACTION : "Selecting the JSON source and uploading a JSON file." : Select "Airport Charges JSON" → click "Upload files".
:: SPEAK : "Same process for JSON -- the system parses the structure and shows the seeded preview rows." : Pick a JSON file → watch the preview.
:: VERIFICATION : "Preview shows measurement, recorded_at, record_id fields. Source type remains 'JSON'." : Point to the JSON preview.

### Step 2.6: Smart Match the JSON source
:: ACTION : "Selecting the JSON source and clicking 'Smart Match'." : Click "Smart Match" on the JSON source.
:: SPEAK : "Same behavior -- actuals and one breach (Passenger Services) get created for this JSON source." : Wait.
:: VERIFICATION : "JSON source shows '1 matched' and the 'Linked' status pill." : Show the result.

### Step 2.7: Smart Match remaining sources (REST & SAP)
:: ACTION : "Running Smart Match on the REST and SAP sources." : Click the REST source → "Smart Match" → then SAP source → "Smart Match".
:: SPEAK : "Now linking the Ground Handling REST Feed and SAP S/4HANA Ground Operations. All 4 sources are now linked and ingesting actuals into the KPI engine." : Wait for both to link.
:: VERIFICATION : "All 4 sources show the 'Linked' pill." : Confirm all 4 sources are linked.

---

## PHASE 3 -- Compliance Flags & Escalation

### Step 3.1: Open Flags panel & wait for extracted breaches
:: ACTION : "Navigating to the Flags panel to review extracted breaches." : Click "Flags" tab.
:: SPEAK : "Now that actuals are ingested across all 4 sources, the Flags panel displays 6 open breaches across our tracked KPIs." : Show the panel.
:: VERIFICATION : "6 flags displayed with De-icing as Critical and remaining breaches as High." : Point to each flag's severity badge.

### Step 3.2: Open flag details & show penalty exposure
:: ACTION : "Expanding a breach row to see full detail and financial penalty." : Click the "Details" chevron on the first breach.
:: SPEAK : "Here you can see the KPI, expected vs actual values, variance, penalty exposure, SLA, data source, and the full remedy text." : Expand the row.
:: VERIFICATION : "Expanded row shows Metric detail, Remedy tile (full text wrapping cleanly), SLA tile, Expected vs Actual, Variance, Penalty exposure, and Escalation options." : Walk through each DetailTile.

### Step 3.3: Send escalation email
:: ACTION : "Clicking the 'Escalate' button to send an escalation email to the vendor/carrier." : Click the Escalate button (Mail icon).
:: SPEAK : "This opens the Escalation Alert Email modal. The recipient is resolved from the contract parties, and the email body is auto-generated with KPI details, penalty exposure, and clause reference." : Show the modal.
:: VERIFICATION : "Modal shows To field, Subject line with KPI & severity, and editable body textarea." : Point to the fields.

### Step 3.4: Dispatch alert & verify status transition
:: ACTION : "Clicking 'Dispatch Alert' to send the email." : Click the Dispatch button.
:: SPEAK : "Dispatching records the alert (mock_dispatched in demo mode) and immediately transitions the breach status from 'Open' to 'In Action'." : Click dispatch.
:: VERIFICATION : "Toast notification appears: 'Escalation logged'. Status badge changes from 'Open' (red) to 'In Action' (blue)." : Point to the updated status badge.

---

## PHASE 4 -- Recoveries Management

### Step 4.1: Open Recoveries panel
:: ACTION : "Switching to the Recoveries Management panel." : Click "Recoveries" tab.
:: SPEAK : "This panel centralizes all active breach recoveries. Notice that the breach we escalated now shows 'In Action' status." : Show the panel.
:: VERIFICATION : "Recoveries list displays active items with severity levels. The escalated recovery shows 'In Action'." : Point to the escalated recovery card.

### Step 4.2: Expand recovery details
:: ACTION : "Expanding the escalated recovery row." : Click the Details chevron on the row.
:: SPEAK : "The expanded view provides the full breach context, calculated financial recovery amount, and historical log of previous actions." : Expand the row.
:: VERIFICATION : "Detail tiles show metric, remedy, SLA, expected vs actual, variance, data source, and previous dispatch history." : Point to the details.

### Step 4.3: Send follow-up email from Recoveries
:: ACTION : "Clicking 'Send Escalation Alert Email' on the recovery row." : Click the Escalate/Mail button in the expanded recovery row.
:: SPEAK : "We can send a follow-up notification directly from Recoveries Management to maintain auditability and push for resolution." : Demonstrate editing and dispatching.
:: VERIFICATION : "Follow-up email modal dispatches smoothly and appends a new entry to the follow-up actions history." : Show the updated actions history.

---

## PHASE 5 -- Heatmap & Review KPI Graphs

### Step 5.1: Open Heatmap panel & review coverage
:: ACTION : "Navigating to the KPI Heatmap panel." : Click "Heatmap" tab.
:: SPEAK : "The Heatmap provides an executive matrix of compliance coverage across IATA service categories." : Show the panel.
:: VERIFICATION : "Summary cards at top (Tracked Clear, Active Breaches, Accepted, Deferred), followed by Coverage by Service Category chart and KPI Tracking Matrix." : Point out the category distribution bars and color dots.

### Step 5.2: Show populated graphs in Review KPI pane
:: ACTION : "Navigating to the Review tab (or scrolling to Financial Exposure section)." : Click "Review" tab and scroll to charts/analytics.
:: SPEAK : "Now that actuals are ingested, the Review pane displays populated analytics: Penalty Exposure by KPI, Breaches by Category, Recovery Pipeline, and Contract Rate Cards." : Point to each populated chart.
:: VERIFICATION : "Charts show populated penalty totals (SEK/USD), severity distribution, pipeline stages, and rate reference curves." : Walk through the charts.

---

## PHASE 6 -- Contract Guardian Queries

### Step 6.1: Navigate to Contract page & run 1st query card
:: ACTION : "Navigating back to the main Contract detail page and opening Contract Guardian." : Click Contract view → locate Contract Guardian query cards.
:: SPEAK : "Contract Guardian allows interactive Q&A directly against the legal text and KPI register. Let's run the 1st suggested query card." : Click the 1st query card.
:: VERIFICATION : "Contract Guardian processes the query and returns an accurate answer grounded in the contract text." : Point to the response.

### Step 6.2: Run 2nd query card in Contract Guardian
:: ACTION : "Clicking the 2nd query card in Contract Guardian." : Click the 2nd query card.
:: SPEAK : "Running the 2nd query card demonstrates how contract managers can quickly verify penalty terms, SLA tolerances, or liability caps." : Click the card → watch response stream.
:: VERIFICATION : "Guardian responds with precise clause citations and contract metadata." : Show the answer with clause citations.

---

## PHASE 7 -- Post-Ingestion Project Dashboard (End-to-End Complete)

### Step 7.1: Return to Project Dashboard & show updated metrics
:: ACTION : "Returning to the main Project Dashboard to view the final portfolio state." : Click the main Dashboard tab.
:: SPEAK : "To close our end-to-end workflow, we return to the project dashboard. The baseline portfolio now seamlessly incorporates the newly ingested airport contract data." : Show the updated dashboard.
:: VERIFICATION : "Total Obligations reflect +19 extracted airport KPIs. Current Exposure includes the new open breach penalties. Charts plot the 'Live project' trend point alongside historical portfolio data." : Point to summary cards and trend graphs.
:: SPEAK : "Notice how multi-currency items are cleanly segregated (USD vs SEK At Risk) and linked sources display human-readable names. This completes the end-to-end obligation tracking lifecycle." : Point to currency cards and source badges.

---

## END OF DEMO

## Key Architecture Points to Highlight

- **Filename detection**: Any contract named `airport-charges-2025.pdf` triggers the demo with ground-truth data.
- **No AI latency for demo**: Deterministic demo builder provides fast, reliable, reproducible presentation results.
- **Staged data flow**: Contract Ingestion → KPI Extraction → Source Linking & Smart Match → Breach Detection → Escalation & Recoveries → Contract Guardian → Project Portfolio Dashboard.
- **No real emails sent**: Escalations and follow-ups log as `mock_dispatched` for clean demo isolation.
- **Multi-source integration**: CSV, JSON, REST API, and SAP S/4HANA sources each link seamlessly to specific KPIs.
```
