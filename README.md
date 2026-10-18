# Campus Pulse

A live crowd map for Imperial (demo data). Heat comes from made-up course timetables, simulated ID tap-ins, student check-ins and Gemini predictions.

## Features
- **Heat map and AI insight** for 07:00 to 23:30, including evenings. Gemini is asked to assume that not every student comes in, and the expected attendance for the day is shown.
- **My day:** pick a course and year to see that day's timetable, with directions to each room and ideas for the free gaps between classes.
- **Places:** campus buildings, study, quiet, social and music spaces, and real restaurants, cafes and libraries near campus (found with Google Places).
- **Click any place** on the map for photos, rating, opening hours, website and busyness, plus a forecast chart for the next hours.
- **Forecast tab:** compare two places side by side.
- **Directions:** outdoor walking route that avoids busy spots, and indoor corridor, lift and stairs directions (demo floor plans).
- **Lunch and spaces finders**, with a step-free option.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in DATABASE_URL, GOOGLE_MAPS_API_KEY and GEMINI_API_KEY.
3. In Google Cloud enable **Maps JavaScript API**, **Routes API** and **Places API (New)** for your key.
4. `npm run seed` (takes a minute or two because Gemini predicts each weekday). Re-run it on each day you demo.
5. `npm start`, then open http://localhost:3000

## Notes
- Course timetables, tap-ins and indoor floor plans are made up. Replace `courses.js` and `indoor.js` with real data later.
- Predictions come from `predict.js`: a rule-based baseline refined by Gemini. If Gemini fails, the baseline is used.
- `DEMO_CHECKINS=true` skips the location check for check-ins.
