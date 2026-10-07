"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface ReportChartProps {
  data: { name: string; activeMinutes: number }[];
}

export default function ReportChart({ data }: ReportChartProps) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-400">
        No reading data yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          unit=" min"
          tick={{ fontSize: 12, fill: "#6b7280" }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip
          formatter={(value) => [
            `${typeof value === "number" ? value : 0} minutes active`,
            "Active Time",
          ]}
          contentStyle={{
            borderRadius: "8px",
            border: "1px solid #e5e7eb",
            fontSize: "12px",
          }}
        />
        <Bar dataKey="activeMinutes" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill="#3b82f6" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
