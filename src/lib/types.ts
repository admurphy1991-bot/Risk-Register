export type Control = {
  id: string;
  riskId: string;
  description: string;
  type: string;
  implemented: boolean;
  createdAt: string;
};

export type Risk = {
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  ownerName: string;
  inherentLikelihood: number | null;
  inherentConsequence: number | null;
  inherentScore: number | null;
  residualLikelihood: number | null;
  residualConsequence: number | null;
  residualScore: number | null;
  status: string;
  nextReviewDate: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  controls: Control[];
};
