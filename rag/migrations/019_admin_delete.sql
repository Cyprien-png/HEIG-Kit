-- Shared items (decks and their cards, quizzes and their questions, library items) are deleted by administrators only:
-- a deletion takes the item, and the progress made on it, away from the whole class. Authors still change their own.
DROP POLICY remove ON decks;
DROP POLICY remove ON quizzes;
DROP POLICY remove ON library_items;
DROP POLICY remove ON cards;
DROP POLICY remove ON quiz_questions;
CREATE POLICY remove ON decks FOR DELETE USING (heig_admin());
CREATE POLICY remove ON quizzes FOR DELETE USING (heig_admin());
CREATE POLICY remove ON library_items FOR DELETE USING (heig_admin());
CREATE POLICY remove ON cards FOR DELETE USING (heig_admin());
CREATE POLICY remove ON quiz_questions FOR DELETE USING (heig_admin());
