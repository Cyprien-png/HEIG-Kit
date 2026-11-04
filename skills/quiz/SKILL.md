---
name: quiz
description: Creates true/false quizzes from the user's HEIG-VD course material and runs them, on the web app (cards swiped right for true, left for false) or aloud with the user, one statement at a time, with the score and the mistakes explained at the end. Use whenever the user asks for a quiz, a "vrai/faux", to be tested or quizzed on a chapter ("fais-moi un quiz sur le chapitre 4 de RXI", "teste-moi sur les relations", "on révise à l'oral"), or to revise without a screen (in the car, walking).
---

# Quiz

`<root>` is the plugin root, two levels above this skill's base directory (the folder holding `package.json`). Prefer
the MCP tools when available (`list_quizzes`, `create_quiz`, `start_quiz`, `answer_quiz`, `get_quiz_result`,
`delete_quiz`, prompt `voice_quiz`); the commands below do the same: `npm --prefix <root> run -s quiz -- list`,
`quiz -- show <id>`, `quiz -- create --file quiz.json`, `quiz -- play <id>` (interactive), `quiz -- result <attempt id>`.

## Writing a quiz

1. Read the material first (`heig:teacher`: `kb -- search`, `kb -- document`, the chapter's exercises and the class
   quizzes when the course has some). Cover the chapters the user names, or those of the next exam.
2. 10 to 25 statements, **about half true, half false**, in random order. False statements come from the real pitfalls
   of the course: a definition swapped with its neighbour, a value off by one, an inverted condition, a property
   attributed to the wrong layer or the wrong object. Never a trick on wording alone.
3. Each statement is **one sentence that reads well aloud**: numbers and units in words when a voice would stumble
   (« soixante-quatre octets »), no LaTeX, no symbol such as ⊆ or ∀ (say « est inclus dans »). Each has an
   `explanation` (why, with the course's words, two sentences at most) and a `source` (document, chapter, page).
4. `topic`: short and reusable, the same words as the flashcards and the profile (« trame Ethernet », « relation
   d'ordre »), so mistakes can later feed the profile.
5. JSON for the command line:
   `{"title": "RXI · Réseaux locaux", "course": "RXI", "description": "Chapitre 4", "questions": [{"statement": "…", "answer": false, "explanation": "…", "source": "Cours RXI ch. 4 p. 7", "topic": "trame Ethernet"}]}`

## Running it aloud (voice mode, or any chat)

- `start_quiz` gives the attempt id and the first question. **Read the statement exactly as returned**, then wait
  for the answer (vrai/faux, oui/non). Record it with `answer_quiz`, which returns the next question: read it at once,
  without commenting on the previous answer. Never reveal or hint at an answer before the end.
- The last `answer_quiz` returns the result: read the score, then every mistake one by one (the statement, the right
  answer, the explanation). Offer to redo only the mistakes as a new short quiz, or to make flashcards of them
  (`heig:flashcards`), and record recurring ones in the profile (`heig:profile`).
- If the user stops early, `get_quiz_result` closes the attempt and gives the score so far.

## On the web app

The **Quiz** page lists the quizzes; a quiz is played as cards swiped right (vrai) or left (faux), with the score and
the mistakes at the end. Say that the quiz is there when you create one.
