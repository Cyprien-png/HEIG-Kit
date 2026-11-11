---
name: quiz
description: Creates quizzes of true/false statements and multiple-choice questions (QCM) from the user's HEIG-VD course material and runs them, on the web app (statements swiped right for true, left for false; a QCM ticked in a form) or aloud with the user, one question at a time, with the score and the mistakes explained at the end. Use whenever the user asks for a quiz, a "vrai/faux", a QCM or "questions à choix multiple", to be tested or quizzed on a chapter ("fais-moi un quiz sur le chapitre 4 de RXI", "teste-moi sur les relations", "on révise à l'oral"), or to revise without a screen (in the car, walking).
---

# Quiz

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). Prefer
the MCP tools when available (`list_quizzes`, `create_quiz`, `start_quiz`, `answer_quiz`, `get_quiz_result`,
`delete_quiz`, prompt `voice_quiz`); the commands below do the same: `npm --prefix <root> run -s quiz -- list`,
`quiz -- show <id>`, `quiz -- create --file quiz.json`, `quiz -- play <id>` (interactive), `quiz -- result <attempt id>`.

## Writing a quiz

**Before writing anything, list what exists**: `quiz -- list` (MCP: `list_quizzes`; `mine: true` for the user's own).
On a shared server (`HEIG_REMOTE_URL` set, or a remote MCP server) the quizzes are the whole class's, each with its
author, and everyone plays them with their own attempts and score. You MUST NOT create a quiz when one already covers
the chapter and the kind asked: start that one (`start_quiz`) and say who made it. The server refuses a similar quiz
and lists the existing ones; it only accepts after you read them (`quiz -- show <id>`) and call again with `checked`
(their references) and `new_because` (what the user needs that each of them lacks; CLI: `--checked`, `--new-because`).
Never invent these to get through. Deleting a quiz is reserved to administrators there, even for its author: a
refusal is final, tell the user to ask one.

1. Read the material first (`heig:teacher`: `kb -- search`, `kb -- document`, the chapter's exercises and the class
   quizzes when the course has some). Cover the chapters the user names, or those of the next exam.
2. **True/false or QCM.** A quiz holds true/false statements, multiple-choice questions, or both. Make a QCM when the
   user asks for one (« QCM », « choix multiple »), and mix in a few in a long true/false quiz to vary. A QCM question
   has `options` (3 or 4, short, read with their letters A, B, C, D) and `correct`, the letter(s) of the right ones;
   several right options only when the statement says so (« plusieurs réponses »). The wrong options are the course's
   real pitfalls, and the right letter changes from one question to the next.
3. As many questions as the material calls for (10 at least; a hundred or more when several chapters are covered: the user
   decides the size, never shorten a quiz to fit a number), **about half true, half false**, in random order. False statements come from the real pitfalls
   of the course: a definition swapped with its neighbour, a value off by one, an inverted condition, a property
   attributed to the wrong layer or the wrong object. Never a trick on wording alone.
4. Each statement is **one sentence that reads well aloud**: numbers and units in words when a voice would stumble
   (« soixante-quatre octets »), no symbol such as ⊆ or ∀ (say « est inclus dans »). The web app renders LaTeX
   between `$…$` on the cards, so a quiz meant for the screen (mathematics) may use it; a quiz to be done aloud
   must not. Each has an `explanation` (why, with the course's words, two sentences at most) and a `source`
   (document, chapter, page).
5. `topic`: short and reusable, the same words as the flashcards and the profile (« trame Ethernet », « relation
   d'ordre »). `chapter`: the chapter of the course as the profile names it (`profile -- chapters RXI`, or
   `get_profile`; define them first with `heig:profile` if the course has none) and `section` (its sub-chapter): the
   last attempt of the quiz then counts in the profile, one point for or against the chapter and the section per answer.
6. JSON for the command line (a QCM question has `options` and `correct` instead of `answer`):
   `{"title": "RXI · Réseaux locaux", "course": "RXI", "description": "Chapitre 4", "questions": [{"statement": "…", "answer": false, "explanation": "…", "source": "Cours RXI ch. 4 p. 7", "topic": "trame Ethernet", "chapter": "4. Réseaux locaux", "section": "Ethernet"}, {"statement": "Quelle est la taille d'une adresse MAC ?", "options": ["32 bits", "48 bits", "64 bits", "128 bits"], "correct": ["B"], "explanation": "…"}]}`

## Running it aloud (voice mode, or any chat)

- `start_quiz` gives the attempt id and the first question (`shuffle: true` asks them in a random order, good for a
  quiz already done once). **Read the statement exactly as returned**; for a QCM, then read each option with its letter
  (« A : … ») and say whether one or several answers are expected. Wait for the answer: vrai/faux or oui/non
  (`answer`), or the letter or letters for a QCM (`choice`, e.g. « B » or « A et C », as the user said it). Record it with `answer_quiz`, which returns the next question: read it at once,
  without commenting on the previous answer. Never reveal or hint at an answer before the end.
- The last `answer_quiz` returns the result: read the score, then every mistake one by one (the statement, the right
  answer, the explanation). Offer to redo only the mistakes as a new short quiz, or to make flashcards of them
  (`heig:flashcards`), and record recurring ones in the profile (`heig:profile`).
- If the user stops early, `get_quiz_result` closes the attempt and gives the score so far.

## On the web app

The **Quiz** page lists the quizzes (marked vrai/faux, QCM or both); a statement is a card swiped right (vrai) or left
(faux), a QCM is a form whose options are ticked (a tap, or the letter keys) then validated, with the score and the
mistakes, right options in green, at the end. In the terminal, `quiz -- play` asks for the letters of a QCM. Say that the quiz is there when you create one.
