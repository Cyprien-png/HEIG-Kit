import assert from "node:assert/strict";
import { after, test } from "node:test";
import { answerQuestion, attemptResult, createQuiz, deleteQuiz, finishAttempt, getQuiz, listQuizzes, speakResult, startAttempt } from "../src/app/quizzes.js";
import type { Db } from "../src/rag/db.js";
import { testDb } from "./helpers/db.js";

const db: Db | undefined = await testDb("heigkit_test_quiz");
after(async () => db?.end());

test("a quiz is answered one question at a time and finishes with a score and the mistakes", { skip: !db && "no local database" }, async () => {
  await assert.rejects(createQuiz(db!, { title: "x" }, []), /at least one question/);
  const quiz = await createQuiz(db!, { title: "RXI · Ethernet", course: "RXI" }, [
    { statement: "Une adresse MAC compte six octets.", answer: true, explanation: "48 bits, notés en hexadécimal.", source: "Cours RXI ch. 4", topic: "adresse MAC" },
    { statement: "Le champ Type d'une trame Ethernet II donne la longueur des données.", answer: false, explanation: "Il indique le protocole de la couche supérieure ; c'est 802.3 qui a un champ longueur.", topic: "trame Ethernet" },
    { statement: "Un switch apprend les adresses MAC sources des trames qu'il reçoit.", answer: true },
  ]);
  assert.equal(quiz.questionList.length, 3);
  assert.equal((await listQuizzes(db!, "rxi"))[0].id, quiz.id);

  const started = await startAttempt(db!, quiz.id, "voice");
  assert.equal(started.attempt.total, 3);
  assert.equal(started.next?.position, 1);
  assert.equal("answer" in (started.next ?? {}), false, "the asked question never carries its answer");

  const first = await answerQuestion(db!, started.attempt.id, true);
  assert.equal(first.correct, true);
  assert.equal(first.next?.position, 2);
  await assert.rejects(answerQuestion(db!, started.attempt.id, true, started.next!.id), /already answered/);
  const second = await answerQuestion(db!, started.attempt.id, true, first.next!.id);
  assert.equal(second.correct, false);
  assert.equal(second.result, undefined);
  const last = await answerQuestion(db!, started.attempt.id, true);
  assert.ok(last.result, "the last answer finishes the attempt");
  assert.equal(last.result!.attempt.score, 2);
  assert.deepEqual(last.result!.mistakes.map((m) => m.position), [2]);
  assert.match(speakResult(last.result!), /Score : 2 sur 3\.\n1 erreur :\n2\. « Le champ Type .* » est faux\. Il indique/);
  await assert.rejects(answerQuestion(db!, started.attempt.id, false), /finished/);

  // An attempt abandoned halfway: finishing counts the rest as wrong.
  const again = await startAttempt(db!, quiz.id);
  await answerQuestion(db!, again.attempt.id, false);
  const result = await finishAttempt(db!, again.attempt.id);
  assert.equal(result.attempt.score, 0);
  assert.equal(result.mistakes.length, 3);
  assert.equal(result.mistakes[1].answer, undefined);
  const summary = (await getQuiz(db!, quiz.id))!;
  assert.equal(summary.attempts, 2);
  assert.deepEqual(summary.best, { score: 2, total: 3 });
  assert.equal(summary.last?.score, 0);

  // A shuffled attempt keeps its own order: numbered from one, every question once, the result in the same order.
  const shuffled = await startAttempt(db!, quiz.id, "web", { shuffle: true });
  assert.equal(shuffled.next?.position, 1);
  const seen = [shuffled.next!.id];
  let step = await answerQuestion(db!, shuffled.attempt.id, true, shuffled.next!.id);
  assert.equal(step.next?.position, 2);
  seen.push(step.next!.id);
  step = await answerQuestion(db!, shuffled.attempt.id, true);
  assert.equal(step.next?.position, 3);
  seen.push(step.next!.id);
  step = await answerQuestion(db!, shuffled.attempt.id, true);
  assert.deepEqual([...seen].sort(), quiz.questionList.map((q) => q.id).sort());
  assert.deepEqual(step.result!.answers.map((a) => a.questionId), seen);
  assert.deepEqual(step.result!.answers.map((a) => a.position), [1, 2, 3]);
  assert.deepEqual((await attemptResult(db!, started.attempt.id))!.answers.map((a) => a.position), [1, 2, 3]);

  assert.equal(await deleteQuiz(db!, quiz.id), true);
  assert.equal(await attemptResult(db!, again.attempt.id), undefined);
});
