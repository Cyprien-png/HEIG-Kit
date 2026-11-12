import { type ReactNode, Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NeedsCampus, Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { SessionProvider, pendingAuthorization, useSession } from "./lib/auth";
import { Account, Setup } from "./pages/Account";
import { Login } from "./pages/Login";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Calendar = lazy(() => import("./pages/Calendar").then((m) => ({ default: m.Calendar })));
const Courses = lazy(() => import("./pages/Courses").then((m) => ({ default: m.Courses })));
const CourseDetail = lazy(() => import("./pages/CourseDetail").then((m) => ({ default: m.CourseDetail })));
const DocumentView = lazy(() => import("./pages/DocumentView").then((m) => ({ default: m.DocumentView })));
const Library = lazy(() => import("./pages/Library").then((m) => ({ default: m.Library })));
const Decks = lazy(() => import("./pages/Decks").then((m) => ({ default: m.Decks })));
const DeckDetail = lazy(() => import("./pages/DeckDetail").then((m) => ({ default: m.DeckDetail })));
const Study = lazy(() => import("./pages/Study").then((m) => ({ default: m.Study })));
const Quizzes = lazy(() => import("./pages/Quizzes").then((m) => ({ default: m.Quizzes })));
const QuizPlay = lazy(() => import("./pages/QuizPlay").then((m) => ({ default: m.QuizPlay })));
const QuizResult = lazy(() => import("./pages/QuizResult").then((m) => ({ default: m.QuizResult })));
const MockExams = lazy(() => import("./pages/MockExams").then((m) => ({ default: m.MockExams })));
const WorkCopies = lazy(() => import("./pages/WorkCopies").then((m) => ({ default: m.WorkCopies })));
const WorkCopyEditor = lazy(() => import("./pages/WorkCopies").then((m) => ({ default: m.WorkCopyEditor })));
const PastExams = lazy(() => import("./pages/PastExams").then((m) => ({ default: m.PastExams })));
const Corrections = lazy(() => import("./pages/Corrections").then((m) => ({ default: m.Corrections })));
const CorrectionDetail = lazy(() => import("./pages/CorrectionDetail").then((m) => ({ default: m.CorrectionDetail })));
const Capture = lazy(() => import("./pages/Capture").then((m) => ({ default: m.Capture })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Grades = lazy(() => import("./pages/Grades").then((m) => ({ default: m.Grades })));
const Studies = lazy(() => import("./pages/Studies").then((m) => ({ default: m.Studies })));
const Journal = lazy(() => import("./pages/Journal").then((m) => ({ default: m.Journal })));
const Status = lazy(() => import("./pages/Status").then((m) => ({ default: m.Status })));
const Revision = lazy(() => import("./pages/Hub").then((m) => ({ default: m.Revision })));
const Etudes = lazy(() => import("./pages/Hub").then((m) => ({ default: m.Etudes })));

function Protected({ children }: { children: ReactNode }) {
  const { me, ready } = useSession();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  // Until the first password is replaced and edu-ID connected, the application is this and nothing else.
  if (me.setup) return <Setup me={me} />;
  // An application (Claude, the CLI) sent the person here to log in: back to its authorization.
  const waiting = pendingAuthorization(location.search);
  if (waiting) {
    window.location.replace(waiting);
    return <Loading />;
  }
  return <Shell>{children}</Shell>;
}

/** Pages of the administrators; the server refuses their data to anyone else anyway. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return me?.role === "admin" ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/capture/:id" element={<Capture />} />
            <Route
              path="/*"
              element={
                <Protected>
                  <Suspense fallback={<Loading />}>
                    <Routes>
                      <Route index element={<Dashboard />} />
                      <Route path="calendar" element={<NeedsCampus><Calendar /></NeedsCampus>} />
                      <Route path="revision" element={<Revision />} />
                      <Route path="etudes" element={<Etudes />} />
                      <Route path="courses" element={<Courses />} />
                      <Route path="courses/:code" element={<CourseDetail />} />
                      <Route path="documents/:id" element={<DocumentView />} />
                      <Route path="library" element={<Library />} />
                      <Route path="library/:kind/:name" element={<Library />} />
                      <Route path="cards" element={<Decks />} />
                      <Route path="cards/:id" element={<DeckDetail />} />
                      <Route path="study" element={<Study />} />
                      <Route path="study/:id" element={<Study />} />
                      <Route path="quiz" element={<Quizzes />} />
                      <Route path="quiz/play/:id" element={<QuizPlay />} />
                      <Route path="quiz/attempts/:id" element={<QuizResult />} />
                      <Route path="exams" element={<MockExams />} />
                      <Route path="past-exams" element={<PastExams />} />
                      <Route path="past-exams/*" element={<PastExams />} />
                      <Route path="copies" element={<WorkCopies />} />
                      <Route path="copies/:id" element={<WorkCopyEditor />} />
                      <Route path="corrections" element={<Corrections />} />
                      <Route path="corrections/:id" element={<CorrectionDetail />} />
                      <Route path="profile" element={<Profile />} />
                      <Route path="grades" element={<NeedsCampus><Grades /></NeedsCampus>} />
                      <Route path="studies" element={<NeedsCampus><Studies /></NeedsCampus>} />
                      <Route path="account" element={<Account />} />
                      <Route path="status" element={<AdminOnly><Status /></AdminOnly>} />
                      <Route path="journal" element={<AdminOnly><Journal /></AdminOnly>} />
                      <Route path="journal/:id" element={<AdminOnly><Journal /></AdminOnly>} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                </Protected>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </SessionProvider>
  );
}
