---
name: flashcards
description: Creates and manages the user's revision flashcards (recto/verso decks studied on the HEIG-Kit web app like Quizlet) from their course material. Use whenever the user asks for flashcards, "cartes de révision", "cartes recto-verso", a deck or "paquet" on a chapter, to quiz them, or what is due to study.
---

# Flashcards

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). The
cards live on the remote server when `HEIG_REMOTE_URL` is set, otherwise in the local database.

## Commands

- `npm --prefix <root> run -s cards -- list [--course MAD]`: decks with cards, due and new counts.
- `npm --prefix <root> run -s cards -- show <deck id>`: the cards of a deck.
- `npm --prefix <root> run -s cards -- create "<title>" --course <CODE> --file cards.json`: a new deck with its cards.
- `npm --prefix <root> run -s cards -- add <deck id> --file cards.json`: more cards.
- `npm --prefix <root> run -s cards -- study [<deck id>]`: what is due now (to quiz the user in the terminal).
- `cards -- delete-card <id>`, `cards -- delete-deck <id>`.

`cards.json` is `{ "cards": [ { "front": "…", "back": "…", "hint": "…", "tags": ["…"], "source": "Cours MAD ch. 1 p. 32" } ] }`,
Markdown with LaTeX between `$…$` on both faces (`"$|A \\cup B| = |A| + |B| - |A \\cap B|$"`); a face may also hold a
Markdown table, a ```` ```mermaid ```` diagram (a small Hasse diagram, an automaton, a chart) or a ```` ```svg ```` drawing,
which the web app renders.

## Making good cards

1. `cards -- list` first: complete an existing deck on the topic rather than making a second one.
2. Read the course material (`heig:teacher`: `kb -- search`, `kb -- document`) and write 20 to 40 cards per chapter:
   one notion per card; a precise question on the front (a definition to give, a formula to complete, a method to
   state, a trap to spot); a short exact answer on the back; the `source` (document, page) on each card; French.
3. Use the user's profile (`npm --prefix <root> run -s profile -- --course <CODE>`): more cards on weak topics and
   frequent mistakes, phrased to catch the mistake ("Que vaut |A ∪ B| quand A et B ne sont pas disjoints ?").
4. Tell the user the deck is ready on the web app under **Cartes**, and how many cards it holds.

## Quizzing in the terminal

With `cards -- study --json`, ask the fronts one by one, compare the user's answer with the back, and say which to
grade again / hard / good / easy on the web app (the terminal does not record grades).
