import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import TaBuilder from "@/components/ta/TaBuilder";

export default async function TaPage({ params }: PageProps<"/tas/[id]">) {
  const user = await getSession();
  if (!user) redirect("/login");
  const { id } = await params;
  return <TaBuilder taId={id} user={{ id: user.id, name: user.name, role: user.role }} />;
}
