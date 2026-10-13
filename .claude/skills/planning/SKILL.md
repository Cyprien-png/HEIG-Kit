---
name: planning
description: Answer questions about the user's HEIG-VD class schedule (GAPS planning). Use whenever the user asks about their courses, lessons, rooms, timetable, free time or holidays, e.g. "what do I have tomorrow?", "when is my next PRG lab?", "am I free Friday afternoon?".
---

# Planning

1. Fetch the schedule from the project root:
   - `npm run -s schedule -- --from YYYY-MM-DD --to YYYY-MM-DD` for a readable view of a period (Europe/Zurich times)
   - `npm run -s schedule -- --all --json` for the whole academic year (times are UTC ISO, convert to Europe/Zurich)
   - add `--refresh` only if the user asks for up-to-date data; the cache is otherwise refreshed every 12 hours
2. Resolve relative dates ("tomorrow", "next week") from today's date in Europe/Zurich.
3. Course codes follow `<COURSE>-<CLASS>-<TYPE><N>`: `C` = lecture (cours), `L` = lab (laboratoire), `A` = support session.
   A multi-day event shown as "all day" (e.g. "Travail personnel") means no regular classes during that period.
4. Answer concisely: day, time range, course, room. Do not dump the whole schedule unless asked.
5. If the command fails on login, report the error and suggest `npm run schedule -- --refresh --debug`. Never print `.env`.
