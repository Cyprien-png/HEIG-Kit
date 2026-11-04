import { type ReactNode, Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import { SessionProvider, useSession } from "./lib/auth";
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
const Corrections = lazy(() => import("./pages/Corrections").then((m) => ({ default: m.Corrections })));
const CorrectionDetail = lazy(() => import("./pages/CorrectionDetail").then((m) => ({ default: m.CorrectionDetail })));
const Capture = lazy(() => import("./pages/Capture").then((m) => ({ default: m.Capture })));
const Profile = lazy(() => import("./pages/Profile").then((m) => ({ default: m.Profile })));
const Grades = lazy(() => import("./pages/Grades").then((m) => ({ default: m.Grades })));
const Studies = lazy(() => import("./pages/Studies").then((m) => ({ default: m.Studies })));
const Status = lazy(() => import("./pages/Status").then((m) => ({ default: m.Status })));
const Revision = lazy(() => import("./pages/Hub").then((m) => ({ default: m.Revision })));
const Etudes = lazy(() => import("./pages/Hub").then((m) => ({ default: m.Etudes })));

function Protected({ children }: { children: ReactNode }) {
  const { username, ready } = useSession();
  const location = useLocation();
  if (!ready) return <Loading />;
  if (!username) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Shell>{children}</Shell>;
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
                      <Route path="calendar" element={<Calendar />} />
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
                      <Route path="corrections" element={<Corrections />} />
                      <Route path="corrections/:id" element={<CorrectionDetail />} />
                      <Route path="profile" element={<Profile />} />
                      <Route path="grades" element={<Grades />} />
                      <Route path="studies" element={<Studies />} />
                      <Route path="status" element={<Status />} />
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
