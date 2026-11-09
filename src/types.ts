export interface FixedIncome {
	id: string;
	month: string;
	name: string;
	amount: number;
	color: string;
	day_of_month: number;
	note: string;
	active: boolean;
}

export interface FixedOutgoing {
	id: string;
	month: string;
	name: string;
	amount: number;
	group_tag: string;
	color: string;
	day_of_month: number;
	note: string;
	active: boolean;
	split_half?: boolean;
}

export interface VariableCategory {
	id: string;
	month: string;
	name: string;
	expected_budget: number;
	color: string;
	icon: string;
	sort_order: number;
}

export interface DailyExpense {
	id: string;
	category_id: string;
	title: string;
	amount: number;
	expense_date: string; // YYYY-MM-DD
	note: string;
	created_at: string;
}

export interface PieSlice {
	id: string;
	label: string;
	value: number;
	color: string;
	sublabel?: string;
	spentAmount?: number;
	group?: 'income' | 'fixed' | 'variable-spent' | 'variable-left' | 'savings';
}

export interface CategoryBreakdown {
	category: VariableCategory;
	spent: number;
	remaining: number;
	overBudget: number;
	effectiveClaim: number;
	percentUsed: number;
	expenses: DailyExpense[];
	pieSlices: PieSlice[];
}

export interface DashboardData {
	month: string; // YYYY-MM
	monthConfirmed: boolean;
	carriedOverFrom: string | null;
	copiedToNextMonth?: boolean;
	backendMode: 'sqlite' | 'supabase' | 'markdown';
	incomes: FixedIncome[];
	fixedOutgoings: FixedOutgoing[];
	variableCategories: VariableCategory[];
	dailyExpenses: DailyExpense[];
}
