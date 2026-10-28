import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import SsspBuilder from "@/components/sssp/SsspBuilder";

export default async function SsspPage({ params }: PageProps<"/sssps/[id]">) {
  const user = await getSession();
  if (!user) redirect("/login");
  const { id } = await params;
  return <SsspBuilder ssspId={id} user={{ id: user.id, name: user.name, role: user.role }} />;
}
