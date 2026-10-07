"use client";

import { useState } from "react";
import { formatSeconds } from "@/lib/utils/time";

interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  active_seconds: number;
  idle_seconds: number;
  last_page: number;
}

interface StudentSessions {
  studentId: string;
  fullName: string;
  sessions: Session[];
}

interface SessionHistoryProps {
  students: StudentSessions[];
}

export default function SessionHistory({ students }: SessionHistoryProps) {
  return (
    <div className="space-y-3">
      {students.map((student) => (
        <StudentSection key={student.studentId} student={student} />
      ))}
    </div>
  );
}

function StudentSection({ student }: { student: StudentSessions }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="font-medium text-gray-900">
          {open ? "▼" : "▶"}{" "}
          {student.fullName}{" "}
          <span className="ml-1 text-sm font-normal text-gray-500">
            ({student.sessions.length} session
            {student.sessions.length !== 1 ? "s" : ""})
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {student.sessions.length === 0 ? (
            <p className="px-6 py-4 text-sm text-gray-400">No sessions yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-6 py-2">#</th>
                    <th className="px-6 py-2">Started</th>
                    <th className="px-6 py-2">Ended</th>
                    <th className="px-6 py-2">Active</th>
                    <th className="px-6 py-2">Idle</th>
                    <th className="px-6 py-2">Last Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {student.sessions.map((session, i) => (
                    <tr
                      key={session.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-3 text-gray-400">{i + 1}</td>
                      <td className="px-6 py-3 text-gray-600">
                        {new Date(session.started_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {session.ended_at ? (
                          new Date(session.ended_at).toLocaleString()
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
                            In progress
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {formatSeconds(session.active_seconds ?? 0)}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {formatSeconds(session.idle_seconds ?? 0)}
                      </td>
                      <td className="px-6 py-3 text-gray-600">
                        {session.last_page}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
