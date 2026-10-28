import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ChemicalRegister from "@/components/chemicals/ChemicalRegister";

export default async function ChemicalsPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  return <ChemicalRegister canEdit={user.role === "admin" || user.role === "hs"} />;
}
