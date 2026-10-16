"use client";

import { useEffect, useState, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";


interface LeaveRequest {
  id: string;
  email: string;
  start_date: string;
  end_date: string;
  reason: string;
  status: "대기" | "승인" | "반려";
  created_at: string;
}

type MemberRole = "직원" | "팀장" | null;

function formatKoreanError(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);

  const lower = rawMessage.toLowerCase();

  if (
    lower.includes("invalid login credentials") ||
    lower.includes("invalid_credentials")
  ) {
    return "이메일 또는 비밀번호가 맞지 않습니다";
  }

  if (
    lower.includes("user already registered") ||
    lower.includes("user_already_exists") ||
    lower.includes("already registered")
  ) {
    return "이미 가입된 이메일입니다. 로그인으로 들어오세요";
  }

  if (
    lower.includes("password should be at least 6 characters") ||
    lower.includes("weak_password") ||
    lower.includes("at least 6 characters")
  ) {
    return "비밀번호는 6자 이상으로 해 주세요";
  }

  if (
    lower.includes("email not confirmed") ||
    lower.includes("email_not_confirmed")
  ) {
    return "확인 메일 설정이 켜져 있습니다. 강사에게 알려 주세요";
  }

  return `오류가 발생했습니다. (${rawMessage})`;
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authInitializing, setAuthInitializing] = useState(true);

  // Auth form states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Member role states
  const [memberRole, setMemberRole] = useState<MemberRole>(null);
  const [roleLoading, setRoleLoading] = useState(false);

  // Leave request form states
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Leave requests list states
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const clearUserData = useCallback(() => {
    setMemberRole(null);
    setLeaveRequests([]);
    setStartDate("");
    setEndDate("");
    setReason("");
    setAppError(null);
    setUpdatingId(null);
  }, []);

  // 어떤 줄이 보일지는 DB 규칙(RLS)이 정하므로 이메일 필터 없이 그대로 조회
  const fetchLeaveRequests = useCallback(async () => {
    setListLoading(true);
    const { data, error } = await supabase
      .from("leave_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setAppError(formatKoreanError(error));
    } else {
      setLeaveRequests((data as LeaveRequest[]) ?? []);
    }
    setListLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;

    if (!isSupabaseConfigured) {
      setAuthInitializing(false);
      setAuthError(
        "Supabase 환경 변수가 설정되지 않았습니다. Vercel 프로젝트 설정(Settings > Environment Variables)에서 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY를 추가해 주세요."
      );
      return;
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!mounted) return;
      setSession(currentSession);
      setAuthInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthInitializing(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const userEmail = session?.user?.email;

    // 세션이 바뀌거나 로그아웃하면 이전 사용자의 신청·명단 정보를 모두 비움
    clearUserData();

    if (!userEmail) {
      setRoleLoading(false);
      return;
    }

    const loadMemberAndRequests = async () => {
      setRoleLoading(true);
      const { data: memberData, error: memberError } = await supabase
        .from("members")
        .select("role")
        .eq("email", userEmail)
        .maybeSingle();

      if (cancelled) return;

      if (memberError) {
        setAppError(formatKoreanError(memberError));
        setMemberRole(null);
        setRoleLoading(false);
        return;
      }

      const role = (memberData?.role as MemberRole) ?? null;
      setMemberRole(role);
      setRoleLoading(false);

      if (role === "직원" || role === "팀장") {
        await fetchLeaveRequests();
      }
    };

    loadMemberAndRequests();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.email, clearUserData, fetchLeaveRequests]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthError("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }

    if (password.length < 6) {
      setAuthError("비밀번호는 6자 이상으로 해 주세요");
      return;
    }

    setAuthLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    setAuthLoading(false);

    if (error) {
      setAuthError(formatKoreanError(error));
    }
  };

  const handleSignUp = async () => {
    setAuthError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setAuthError("이메일과 비밀번호를 모두 입력해 주세요.");
      return;
    }

    if (password.length < 6) {
      setAuthError("비밀번호는 6자 이상으로 해 주세요");
      return;
    }

    setAuthLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
    });
    setAuthLoading(false);

    if (error) {
      setAuthError(formatKoreanError(error));
      return;
    }

    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setAuthError("이미 가입된 이메일입니다. 로그인으로 들어오세요");
      return;
    }

    if (data.user && !data.session) {
      setAuthError("확인 메일 설정이 켜져 있습니다. 강사에게 알려 주세요");
    }
  };

  const handleLogout = async () => {
    clearUserData();
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAppError(formatKoreanError(error));
    }
  };

  const handleCreateLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    setAppError(null);

    if (!session?.user?.email) return;

    if (!startDate || !endDate || !reason.trim()) {
      setAppError("시작일, 종료일, 사유를 모두 입력해 주세요.");
      return;
    }

    if (endDate < startDate) {
      setAppError("종료일은 시작일보다 빠를 수 없습니다.");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("leave_requests").insert({
      email: session.user.email,
      start_date: startDate,
      end_date: endDate,
      reason: reason.trim(),
      status: "대기",
    });
    setSubmitting(false);

    if (error) {
      setAppError(formatKoreanError(error));
      return;
    }

    setStartDate("");
    setEndDate("");
    setReason("");
    await fetchLeaveRequests();
  };

  const handleUpdateStatus = async (
    id: string,
    newStatus: "승인" | "반려"
  ) => {
    setAppError(null);
    setUpdatingId(id);

    const { error } = await supabase
      .from("leave_requests")
      .update({ status: newStatus })
      .eq("id", id);

    setUpdatingId(null);

    if (error) {
      setAppError(formatKoreanError(error));
      return;
    }

    await fetchLeaveRequests();
  };

  if (authInitializing) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600">
        로그인 상태를 확인하는 중...
      </div>
    );
  }

  // 비로그인 시: 로그인/가입 화면만 표시
  if (!session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">연차 신청함</h1>
            <p className="mt-1 text-sm text-slate-600">
              이메일과 비밀번호로 로그인하거나 바로 가입하세요.
            </p>
          </div>

          {authError && (
            <div
              role="alert"
              className="mb-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
            >
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                이메일
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 mb-1"
              >
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상 입력"
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div className="pt-2 flex gap-3">
              <button
                type="submit"
                disabled={authLoading}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {authLoading ? "처리 중..." : "로그인"}
              </button>
              <button
                type="button"
                onClick={handleSignUp}
                disabled={authLoading}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                {authLoading ? "처리 중..." : "회원가입"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  const isManager = memberRole === "팀장";
  const isEmployee = memberRole === "직원";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 맨 위: 내 이메일, 역할(직원·팀장), 로그아웃 버튼 */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-slate-900">연차 신청함</h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-700">
                {session.user.email}
              </span>
              {memberRole && (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    isManager
                      ? "bg-purple-100 text-purple-800"
                      : "bg-blue-100 text-blue-800"
                  }`}
                >
                  {memberRole}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {appError && (
          <div
            role="alert"
            className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            {appError}
          </div>
        )}

        {roleLoading ? (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-10 text-center text-slate-500">
            역할 정보를 확인하는 중...
          </div>
        ) : !memberRole ? (
          /* members에 없는 사람이면 안내 문구만 표시 */
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-10 text-center text-slate-700 font-medium">
            명단에 없습니다. 관리자에게 등록을 요청하세요
          </div>
        ) : (
          <>
            {/* 직원이면: 연차 신청 칸 표시 (팀장이면 숨김) */}
            {isEmployee && (
              <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">
                  연차 신청
                </h2>
                <form
                  onSubmit={handleCreateLeave}
                  className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end"
                >
                  <div>
                    <label
                      htmlFor="start_date"
                      className="block text-sm font-medium text-slate-700 mb-1"
                    >
                      시작일
                    </label>
                    <input
                      id="start_date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="end_date"
                      className="block text-sm font-medium text-slate-700 mb-1"
                    >
                      종료일
                    </label>
                    <input
                      id="end_date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reason"
                      className="block text-sm font-medium text-slate-700 mb-1"
                    >
                      사유
                    </label>
                    <input
                      id="reason"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="예: 개인 사정, 병원 진료"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>

                  <div>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                    >
                      {submitting ? "신청 중..." : "연차 신청"}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* 직원이면 「내 신청」, 팀장이면 「전체 신청」 목록 표 */}
            <section className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-900">
                  {isManager ? "전체 신청" : "내 신청"}
                </h2>
                <span className="text-sm text-slate-500">
                  총 {leaveRequests.length}건
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                      <th className="py-3.5 px-6">신청자</th>
                      <th className="py-3.5 px-6">기간</th>
                      <th className="py-3.5 px-6">사유</th>
                      <th className="py-3.5 px-6">상태</th>
                      {isManager && (
                        <th className="py-3.5 px-6 text-right">승인 · 반려</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm">
                    {listLoading && leaveRequests.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isManager ? 5 : 4}
                          className="py-10 text-center text-slate-500"
                        >
                          목록을 불러오는 중...
                        </td>
                      </tr>
                    ) : leaveRequests.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isManager ? 5 : 4}
                          className="py-10 text-center text-slate-500"
                        >
                          등록된 연차 신청 내역이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      leaveRequests.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/80">
                          <td className="py-4 px-6 font-medium text-slate-900">
                            {item.email}
                          </td>
                          <td className="py-4 px-6 text-slate-700 whitespace-nowrap">
                            {item.start_date} ~ {item.end_date}
                          </td>
                          <td className="py-4 px-6 text-slate-700">
                            {item.reason}
                          </td>
                          <td className="py-4 px-6 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                                item.status === "승인"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : item.status === "반려"
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {item.status}
                            </span>
                          </td>
                          {isManager && (
                            <td className="py-4 px-6 text-right whitespace-nowrap">
                              {item.status === "대기" && (
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateStatus(item.id, "승인")
                                    }
                                    disabled={updatingId === item.id}
                                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                                  >
                                    승인
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUpdateStatus(item.id, "반려")
                                    }
                                    disabled={updatingId === item.id}
                                    className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
                                  >
                                    반려
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
