import { useEffect, useState } from "react";
import { Header } from "../components/Header";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent } from "../components/ui/card";
import { addRecord, getRecords, type AppRecord } from "../utils/apiClient";

export function DashboardPage() {
  const [records, setRecords] = useState<AppRecord[]>([]);
  const [title, setTitle] = useState("");

  useEffect(() => {
    getRecords().then(setRecords).catch(() => setRecords([]));
  }, []);

  async function handleAdd() {
    if (!title.trim()) return;
    const record = await addRecord({ title, detail: "" });
    setRecords((prev) => [...prev, record]);
    setTitle("");
  }

  return (
    <div>
      <Header />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex gap-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="หัวข้อใหม่..."
          />
          <Button onClick={handleAdd}>เพิ่ม</Button>
        </div>

        <div className="space-y-2">
          {records.map((r) => (
            <Card key={r.id}>
              <CardContent>{r.title}</CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
