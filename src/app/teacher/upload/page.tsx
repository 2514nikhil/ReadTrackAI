"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Student {
  id: string;
  full_name: string;
}

export default function UploadPage() {
  const router = useRouter();
  const supabase = createClient();

  const [students, setStudents] = useState<Student[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch students list
  useEffect(() => {
    async function loadStudents() {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("role", "student")
        .order("full_name");

      if (!error && data) {
        setStudents(data);
      }
      setStudentsLoading(false);
    }
    loadStudents();
  }, []);

  function toggleStudent(id: string) {
    setSelectedStudents((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    if (chosen) {
      const ext = chosen.name.split(".").pop()?.toLowerCase();
      if (ext !== "pdf" && ext !== "docx") {
        setError("Only PDF and DOCX files are allowed.");
        setFile(null);
        e.target.value = "";
        return;
      }
    }
    setFile(chosen);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!title.trim()) {
      setError("Please enter a title.");
      return;
    }
    if (!file) {
      setError("Please select a file.");
      return;
    }
    if (selectedStudents.length === 0) {
      setError("Please select at least one student.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("file", file);
      formData.append("studentIds", selectedStudents.join(","));

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Upload failed. Please try again.");
        return;
      }

      setSuccess(`Document uploaded and assigned successfully! (ID: ${json.documentId})`);
      setTitle("");
      setFile(null);
      setSelectedStudents([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Document</h1>
        <p className="mt-1 text-sm text-gray-500">
          Upload a PDF or DOCX file and assign it to one or more students.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {success}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        {/* Title */}
        <div className="mb-5">
          <label
            htmlFor="title"
            className="block text-sm font-medium text-gray-700"
          >
            Document Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Chapter 3: Cell Biology"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* File picker */}
        <div className="mb-5">
          <label
            htmlFor="file"
            className="block text-sm font-medium text-gray-700"
          >
            File <span className="text-gray-400">(PDF or DOCX only)</span>
          </label>
          <input
            id="file"
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            onChange={handleFileChange}
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
          />
          {file && (
            <p className="mt-1 text-xs text-gray-400">
              Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {/* Student multi-select */}
        <div className="mb-6">
          <span className="block text-sm font-medium text-gray-700">
            Assign to Students
          </span>
          {studentsLoading ? (
            <p className="mt-2 text-sm text-gray-400">Loading students…</p>
          ) : students.length === 0 ? (
            <p className="mt-2 text-sm text-gray-400">
              No students found. Have students sign up first.
            </p>
          ) : (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
              {students.map((student) => {
                const checked = selectedStudents.includes(student.id);
                return (
                  <label
                    key={student.id}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      checked ? "bg-blue-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleStudent(student.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className={checked ? "font-medium text-blue-800" : "text-gray-700"}>
                      {student.full_name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {selectedStudents.length > 0 && (
            <p className="mt-1 text-xs text-gray-400">
              {selectedStudents.length} student{selectedStudents.length !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Uploading…" : "Upload & Assign"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/teacher")}
            className="rounded-lg border border-gray-300 bg-white px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
