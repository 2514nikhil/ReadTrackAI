"use client";

import { useEffect, useState } from "react";

interface Student {
  id: string;
  full_name: string;
}

export default function TeacherStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  async function loadStudents() {
    const response = await fetch("/api/teacher/students");
    const data = await response.json();
    if (response.ok) {
      setStudents(
        data.students
          .map((row: { profiles: Student | null }) => row.profiles)
          .filter((student: Student | null): student is Student => student !== null)
      );
    } else {
      setMessage({ type: "error", text: data.error ?? "Could not load students." });
    }
    setLoading(false);
  }

  useEffect(() => {
    loadStudents();
  }, []);

  async function addStudent(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    const response = await fetch("/api/teacher/students", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage({ type: "error", text: data.error ?? "Could not add student." });
    } else {
      setEmail("");
      setMessage({ type: "success", text: `${data.student.full_name} was added to your roster.` });
      await loadStudents();
    }
    setSubmitting(false);
  }

  async function removeStudent(id: string) {
    const response = await fetch(`/api/teacher/students?studentId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (response.ok) {
      setStudents((current) => current.filter((student) => student.id !== id));
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Students</h1>
        <p className="mt-1 text-sm text-gray-500">Add students who already have a ReadTrack account.</p>
      </div>

      {message && (
        <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${message.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={addStudent} className="mb-6 flex max-w-xl gap-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="student@example.com"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button type="submit" disabled={submitting} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
          {submitting ? "Adding..." : "Add student"}
        </button>
      </form>

      <div className="max-w-xl rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-5 py-4 font-semibold text-gray-900">My roster</div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-gray-400">Loading students...</p>
        ) : students.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-400">No students added yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {students.map((student) => (
              <li key={student.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-gray-800">{student.full_name}</span>
                <button onClick={() => removeStudent(student.id)} className="text-xs font-medium text-red-600 hover:text-red-800">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
