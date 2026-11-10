import { App, normalizePath, parseYaml, stringifyYaml, TFile, TFolder } from 'obsidian';
import type {
	DashboardData,
	DailyExpense,
	FixedIncome,
	FixedOutgoing,
	VariableCategory
} from './types';

function makeId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatEUR(val: number): string {
	return new Intl.NumberFormat('de-DE', {
		style: 'currency',
		currency: 'EUR',
		maximumFractionDigits: val % 1 === 0 ? 0 : 2
	}).format(val);
}

function formatMonthLabel(ym: string): string {
	const [year, month] = ym.split('-').map(Number);
	if (!year || !month) return ym;
	const d = new Date(year, month - 1, 1);
	return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function shiftYearMonth(ym: string, deltaMonths: number): string {
	const [year, month] = ym.split('-').map(Number);
	if (!year || !month) return ym;
	const d = new Date(year, month - 1 + deltaMonths, 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export class MarkdownFinanceRepository {
	private app: App;
	private rootFolder: string;

	constructor(app: App, rootFolder = 'finances') {
		this.app = app;
		this.rootFolder = rootFolder;
	}

	public setRootFolder(folder: string) {
		this.rootFolder = folder.trim() || 'finances';
	}

	public getMonthFolderPath(month: string): string {
		const [year, m] = month.split('-');
		return normalizePath(`${this.rootFolder}/${year}/${m}`);
	}

	public getOverviewFilePath(month: string): string {
		return normalizePath(`${this.getMonthFolderPath(month)}/${month}-Overview.md`);
	}

	public getExpensesFilePath(month: string): string {
		return normalizePath(`${this.getMonthFolderPath(month)}/${month}-Expenses.md`);
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const parts = normalizePath(folderPath).split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			try {
				const existsOnDisk = await this.app.vault.adapter.exists(current);
				if (!existsOnDisk) {
					await this.app.vault.adapter.mkdir(current);
				}
			} catch {
				// Ignore if created concurrently
			}
		}
	}

	private async readFileSafe(path: string): Promise<string | null> {
		const norm = normalizePath(path);
		const abstractFile = this.app.vault.getAbstractFileByPath(norm);
		if (abstractFile instanceof TFile) {
			return await this.app.vault.read(abstractFile);
		}
		if (await this.app.vault.adapter.exists(norm)) {
			return await this.app.vault.adapter.read(norm);
		}
		return null;
	}

	private async writeFileSafe(path: string, content: string): Promise<void> {
		const norm = normalizePath(path);
		const abstractFile = this.app.vault.getAbstractFileByPath(norm);
		if (abstractFile instanceof TFile) {
			await this.app.vault.modify(abstractFile, content);
			return;
		}
		await this.app.vault.adapter.write(norm, content);
	}

	private async listExistingMonths(): Promise<string[]> {
		const months = new Set<string>();
		const normRoot = normalizePath(this.rootFolder);

		const root = this.app.vault.getAbstractFileByPath(normRoot);
		if (root instanceof TFolder) {
			for (const yearChild of root.children) {
				if (yearChild instanceof TFolder && /^\d{4}$/.test(yearChild.name)) {
					for (const monthChild of yearChild.children) {
						if (monthChild instanceof TFolder && /^\d{2}$/.test(monthChild.name)) {
							const ym = `${yearChild.name}-${monthChild.name}`;
							const overviewPath = this.getOverviewFilePath(ym);
							if (this.app.vault.getAbstractFileByPath(overviewPath) instanceof TFile) {
								months.add(ym);
							}
						}
					}
				}
			}
		}

		try {
			if (await this.app.vault.adapter.exists(normRoot)) {
				const rootListed = await this.app.vault.adapter.list(normRoot);
				for (const yearFolder of rootListed.folders) {
					const yearName = yearFolder.split('/').pop() ?? '';
					if (/^\d{4}$/.test(yearName)) {
						const yearListed = await this.app.vault.adapter.list(yearFolder);
						for (const monthFolder of yearListed.folders) {
							const monthName = monthFolder.split('/').pop() ?? '';
							if (/^\d{2}$/.test(monthName)) {
								const ym = `${yearName}-${monthName}`;
								const overviewPath = this.getOverviewFilePath(ym);
								if (await this.app.vault.adapter.exists(overviewPath)) {
									months.add(ym);
								}
							}
						}
					}
				}
			}
		} catch {
			// Ignore adapter listing errors
		}

		return Array.from(months).sort();
	}

	public async getPreviousPopulatedMonth(currentMonth: string): Promise<string | null> {
		const allMonths = await this.listExistingMonths();
		const prevMonths = allMonths.filter((m) => m < currentMonth).sort();
		for (let i = prevMonths.length - 1; i >= 0; i--) {
			const m = prevMonths[i];
			const content = await this.readFileSafe(this.getOverviewFilePath(m));
			if (content) {
				const parsed = this.parseMarkdownData(m, content);
				if (
					parsed &&
					(parsed.incomes.length > 0 ||
						parsed.fixedOutgoings.length > 0 ||
						parsed.variableCategories.length > 0)
				) {
					return m;
				}
			}
		}
		return null;
	}

	private parseMarkdownData(month: string, content: string): DashboardData | null {
		const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
		if (!match) return null;
		const yamlStr = match[1];
		try {
			let fm: Record<string, unknown> | null = null;
			try {
				fm = parseYaml(yamlStr) as Record<string, unknown> | null;
			} catch {
				fm = null;
			}
			if (!fm || typeof fm !== 'object') {
				const extractArray = (key: string): unknown[] => {
					const re = new RegExp(`^${key}:\\s*(\\[[\\s\\S]*?^\\])`, 'm');
					const m = yamlStr.match(re);
					if (m) {
						try {
							const parsedJson: unknown = JSON.parse(m[1]);
							return Array.isArray(parsedJson) ? parsedJson : [];
						} catch {
							return [];
						}
					}
					return [];
				};
				fm = {
					monthConfirmed: /monthConfirmed:\s*true/.test(yamlStr),
					copiedToNextMonth: /copiedToNextMonth:\s*true/.test(yamlStr),
					carriedOverFrom: '',
					incomes: extractArray('incomes'),
					fixedOutgoings: extractArray('fixedOutgoings'),
					variableCategories: extractArray('variableCategories'),
					dailyExpenses: extractArray('dailyExpenses')
				};
			}

			const incomesRaw = Array.isArray(fm.incomes) ? fm.incomes : [];
			const fixedRaw = Array.isArray(fm.fixedOutgoings) ? fm.fixedOutgoings : [];
			const catsRaw = Array.isArray(fm.variableCategories) ? fm.variableCategories : [];
			const expRaw = Array.isArray(fm.dailyExpenses) ? fm.dailyExpenses : [];

			const incomes: FixedIncome[] = incomesRaw.map((r: Record<string, unknown>) => ({
				id: String(r.id || makeId()),
				month,
				name: String(r.name ?? ''),
				amount: Number(r.amount ?? 0),
				color: String(r.color ?? '#6b846d'),
				day_of_month: Number(r.day_of_month ?? 1),
				note: String(r.note ?? ''),
				active: r.active !== undefined ? Boolean(r.active) : true
			}));

			const fixedOutgoings: FixedOutgoing[] = fixedRaw.map((r: Record<string, unknown>) => ({
				id: String(r.id || makeId()),
				month,
				name: String(r.name ?? ''),
				amount: Number(r.amount ?? 0),
				group_tag: String(r.group_tag ?? 'Fixed'),
				color: String(r.color ?? '#b86b58'),
				day_of_month: Number(r.day_of_month ?? 1),
				note: String(r.note ?? ''),
				active: r.active !== undefined ? Boolean(r.active) : true,
				split_half: Boolean(r.split_half)
			}));

			const variableCategories: VariableCategory[] = catsRaw.map(
				(r: Record<string, unknown>, idx: number) => ({
					id: String(r.id || makeId()),
					month,
					name: String(r.name ?? ''),
					expected_budget: Number(r.expected_budget ?? 0),
					color: String(r.color ?? '#c49a5c'),
					icon: String(r.icon ?? 'folder'),
					sort_order: Number(r.sort_order ?? idx + 1)
				})
			);

			const dailyExpenses: DailyExpense[] = expRaw.map((r: Record<string, unknown>) => ({
				id: String(r.id || makeId()),
				category_id: r.category_id ? String(r.category_id) : '',
				title: String(r.title ?? ''),
				amount: Number(r.amount ?? 0),
				expense_date: String(r.expense_date ?? `${month}-01`),
				note: String(r.note ?? ''),
				created_at: String(r.created_at ?? new Date().toISOString())
			}));

			dailyExpenses.sort((a, b) => {
				if (a.expense_date !== b.expense_date) {
					return b.expense_date.localeCompare(a.expense_date);
				}
				return b.created_at.localeCompare(a.created_at);
			});

			return {
				month,
				monthConfirmed: Boolean(fm.monthConfirmed),
				carriedOverFrom: fm.carriedOverFrom ? String(fm.carriedOverFrom) : null,
				backendMode: 'markdown',
				incomes,
				fixedOutgoings,
				variableCategories,
				dailyExpenses
			};
		} catch {
			return null;
		}
	}

	private buildOverviewMarkdown(data: DashboardData): string {
		const activeIncomes = data.incomes.filter((i) => i.active);
		const activeFixed = data.fixedOutgoings.filter((f) => f.active);
		const totalIncome = activeIncomes.reduce((s, i) => s + i.amount, 0);
		const totalFixed = activeFixed.reduce((s, f) => s + f.amount, 0);
		const sharedFixed = activeFixed.filter((f) => f.split_half);
		const sharedFixedSum = sharedFixed.reduce((s, f) => s + f.amount, 0);
		const roommateHalf = sharedFixedSum / 2;
		const leftAfterFixed = totalIncome - totalFixed;

		const totalExpectedSemiFixed = data.variableCategories.reduce(
			(s, c) => s + c.expected_budget,
			0
		);
		const catSpentMap = new Map<string, number>();
		for (const c of data.variableCategories) {
			const spent = data.dailyExpenses
				.filter((e) => e.category_id === c.id)
				.reduce((s, e) => s + e.amount, 0);
			catSpentMap.set(c.id, spent);
		}
		const totalEffectiveSemiFixed = data.variableCategories.reduce(
			(s, c) => s + Math.max(c.expected_budget, catSpentMap.get(c.id) ?? 0),
			0
		);
		const totalSemiFixedSpent = data.variableCategories.reduce(
			(s, c) => s + (catSpentMap.get(c.id) ?? 0),
			0
		);
		const uncategorizedExpenses = data.dailyExpenses.filter((e) => !e.category_id);
		const totalUncategorized = uncategorizedExpenses.reduce((s, e) => s + e.amount, 0);

		const expectedLeftAtEnd = leftAfterFixed - totalEffectiveSemiFixed - totalUncategorized;
		const actualLeftNow = leftAfterFixed - totalSemiFixedSpent - totalUncategorized;

		const frontmatterObj = {
			finances_pipeline: true,
			month: data.month,
			monthConfirmed: data.monthConfirmed,
			carriedOverFrom: data.carriedOverFrom ?? '',
			updated_at: new Date().toISOString(),
			incomes: data.incomes,
			fixedOutgoings: data.fixedOutgoings,
			variableCategories: data.variableCategories,
			dailyExpenses: data.dailyExpenses
		};

		const yamlText = stringifyYaml(frontmatterObj).trim();

		const lines: string[] = [
			'---',
			yamlText,
			'---',
			'',
			`# Finances Pipeline — ${formatMonthLabel(data.month)}`,
			'',
			'> Managed by the **Finances Pipeline** plugin (`finances/YYYY/MM`). Changes in the visual pipeline view update this Markdown file automatically.',
			'',
			'## Pipeline Summary',
			'',
			'| Stage | Amount |',
			'| :--- | ---: |',
			`| **1. Total Income** | **+${formatEUR(totalIncome)}** |`,
			`| **2. Fixed Spending** | **-${formatEUR(totalFixed)}** |`,
			`| **Roommate Rent Split (÷ 2 of ${formatEUR(sharedFixedSum)})** | **${formatEUR(roommateHalf)}** |`,
			`| **Left After Fixed** | **${formatEUR(leftAfterFixed)}** |`,
			`| **3. Semi-Fixed Budgets (Used: ${formatEUR(totalSemiFixedSpent)})** | **-${formatEUR(totalExpectedSemiFixed)}** |`,
			`| **4. Direct Minus Expenses (No Category)** | **-${formatEUR(totalUncategorized)}** |`,
			`| **What Is Left** | **${formatEUR(expectedLeftAtEnd)}** |`,
			`| **Actual Cash Left Now** | **${formatEUR(actualLeftNow)}** |`,
			'',
			'## 1. Income',
			'',
			'| Name | Amount | Color |',
			'| :--- | ---: | :--- |'
		];

		for (const inc of activeIncomes) {
			lines.push(`| ${inc.name} | ${formatEUR(inc.amount)} | \`${inc.color}\` |`);
		}

		lines.push(
			'',
			'## 2. Fixed Spending',
			'',
			'| Split ½ | Name | Amount | Color |',
			'| :---: | :--- | ---: | :--- |'
		);

		for (const fix of activeFixed) {
			lines.push(
				`| ${fix.split_half ? '✓ ½' : ''} | ${fix.name} | -${formatEUR(fix.amount)} | \`${fix.color}\` |`
			);
		}

		lines.push(
			'',
			'## 3. Semi-Fixed Categories',
			'',
			'| Category | Monthly Budget | Already Used | Still Left |',
			'| :--- | ---: | ---: | ---: |'
		);

		for (const cat of data.variableCategories) {
			const spent = catSpentMap.get(cat.id) ?? 0;
			const left = cat.expected_budget - spent;
			lines.push(
				`| ${cat.name} | ${formatEUR(cat.expected_budget)} | -${formatEUR(spent)} | ${formatEUR(left)} |`
			);
		}

		lines.push(
			'',
			'## 4. What Is Left — Direct Minus Expenses (No Category)',
			'',
			'| Date | Expense | Amount | Note |',
			'| :--- | :--- | ---: | :--- |'
		);

		if (uncategorizedExpenses.length === 0) {
			lines.push('| — | *None* | €0 | |');
		} else {
			for (const exp of uncategorizedExpenses) {
				lines.push(`| ${exp.expense_date} | ${exp.title} | -${formatEUR(exp.amount)} | ${exp.note} |`);
			}
		}

		lines.push(
			'',
			`## All Manually Typed Expenses (${data.dailyExpenses.length})`,
			'',
			'| Date | Expense | Category | Amount | Note |',
			'| :--- | :--- | :--- | ---: | :--- |'
		);

		for (const exp of data.dailyExpenses) {
			const cat = data.variableCategories.find((c) => c.id === exp.category_id);
			const catLabel = cat ? cat.name : 'What Is Left (No Category)';
			lines.push(
				`| ${exp.expense_date} | ${exp.title} | ${catLabel} | -${formatEUR(exp.amount)} | ${exp.note} |`
			);
		}

		lines.push('');
		return lines.join('\n');
	}

	private buildExpensesCompanionMarkdown(data: DashboardData): string {
		const total = data.dailyExpenses.reduce((s, e) => s + e.amount, 0);
		const lines: string[] = [
			'---',
			`month: "${data.month}"`,
			`total_manual_expenses: ${total}`,
			`expense_count: ${data.dailyExpenses.length}`,
			'---',
			'',
			`# Logged Expenses — ${formatMonthLabel(data.month)}`,
			'',
			`Total Manually Typed Expenses: **-${formatEUR(total)}** (${data.dailyExpenses.length} entries)`,
			'',
			'| Date | Expense | Category | Amount | Note |',
			'| :--- | :--- | :--- | ---: | :--- |'
		];

		for (const exp of data.dailyExpenses) {
			const cat = data.variableCategories.find((c) => c.id === exp.category_id);
			const catLabel = cat ? cat.name : 'What Is Left (No Category)';
			lines.push(
				`| ${exp.expense_date} | ${exp.title} | ${catLabel} | -${formatEUR(exp.amount)} | ${exp.note} |`
			);
		}

		lines.push('');
		return lines.join('\n');
	}

	public async saveDashboardData(data: DashboardData): Promise<void> {
		const folderPath = this.getMonthFolderPath(data.month);
		await this.ensureFolderExists(folderPath);

		const overviewPath = this.getOverviewFilePath(data.month);
		const overviewMd = this.buildOverviewMarkdown(data);
		await this.writeFileSafe(overviewPath, overviewMd);

		const expensesPath = this.getExpensesFilePath(data.month);
		const expensesMd = this.buildExpensesCompanionMarkdown(data);
		await this.writeFileSafe(expensesPath, expensesMd);
	}

	public async getDashboardData(month: string): Promise<DashboardData> {
		const overviewPath = this.getOverviewFilePath(month);
		const content = await this.readFileSafe(overviewPath);

		if (content !== null) {
			const parsed = this.parseMarkdownData(month, content);
			if (parsed) {
				return parsed;
			}
		}

		const emptyData: DashboardData = {
			month,
			monthConfirmed: false,
			carriedOverFrom: null,
			backendMode: 'markdown',
			incomes: [],
			fixedOutgoings: [],
			variableCategories: [],
			dailyExpenses: []
		};
		await this.saveDashboardData(emptyData);
		return emptyData;
	}

	public async handleAction(
		actionName: string,
		formData: FormData,
		currentMonth: string
	): Promise<{ error?: string; success?: boolean; message?: string }> {
		const monthFromForm = String(formData.get('month') ?? '').trim();
		const month = /^\d{4}-\d{2}$/.test(monthFromForm) ? monthFromForm : currentMonth;
		const data = await this.getDashboardData(month);

		switch (actionName) {
			case 'confirmMonth': {
				data.monthConfirmed = true;
				await this.saveDashboardData(data);
				return { success: true, message: `Setup confirmed for ${month}.` };
			}

			case 'saveBatchSetup': {
				const confirmAlso = formData.get('confirm_also') === '1';

				const incomeIds = formData.getAll('income_id').map((v) => String(v));
				for (const id of incomeIds) {
					const name = String(formData.get(`income_name_${id}`) ?? '').trim();
					const amount = Number(formData.get(`income_amount_${id}`) ?? 0);
					const color = String(formData.get(`income_color_${id}`) ?? '#6b846d').trim();
					const target = data.incomes.find((i) => i.id === id);
					if (target && name && amount >= 0) {
						target.name = name;
						target.amount = amount;
						target.color = color;
					}
				}

				const newIncomeNames = formData.getAll('new_income_name').map((v) => String(v ?? '').trim());
				const newIncomeAmounts = formData.getAll('new_income_amount').map((v) => Number(v ?? 0));
				const newIncomeColors = formData
					.getAll('new_income_color')
					.map((v) => String(v ?? '#6b846d').trim());
				for (let i = 0; i < newIncomeNames.length; i++) {
					if (newIncomeNames[i] && (newIncomeAmounts[i] ?? 0) > 0) {
						data.incomes.push({
							id: makeId(),
							month,
							name: newIncomeNames[i],
							amount: newIncomeAmounts[i],
							color: newIncomeColors[i] || '#6b846d',
							day_of_month: 1,
							note: '',
							active: true
						});
					}
				}

				const fixedIds = formData.getAll('fixed_id').map((v) => String(v));
				for (const id of fixedIds) {
					const name = String(formData.get(`fixed_name_${id}`) ?? '').trim();
					const amount = Number(formData.get(`fixed_amount_${id}`) ?? 0);
					const color = String(formData.get(`fixed_color_${id}`) ?? '#b86b58').trim();
					const target = data.fixedOutgoings.find((f) => f.id === id);
					if (target && name && amount >= 0) {
						target.name = name;
						target.amount = amount;
						target.color = color;
					}
				}

				const newFixedNames = formData.getAll('new_fixed_name').map((v) => String(v ?? '').trim());
				const newFixedAmounts = formData.getAll('new_fixed_amount').map((v) => Number(v ?? 0));
				const newFixedColors = formData
					.getAll('new_fixed_color')
					.map((v) => String(v ?? '#b86b58').trim());
				for (let i = 0; i < newFixedNames.length; i++) {
					if (newFixedNames[i] && (newFixedAmounts[i] ?? 0) > 0) {
						data.fixedOutgoings.push({
							id: makeId(),
							month,
							name: newFixedNames[i],
							amount: newFixedAmounts[i],
							group_tag: 'Fixed',
							color: newFixedColors[i] || '#b86b58',
							day_of_month: 1,
							note: '',
							active: true,
							split_half: false
						});
					}
				}

				const catIds = formData.getAll('cat_id').map((v) => String(v));
				for (const id of catIds) {
					const name = String(formData.get(`cat_name_${id}`) ?? '').trim();
					const budget = Number(formData.get(`cat_budget_${id}`) ?? 0);
					const color = String(formData.get(`cat_color_${id}`) ?? '#c49a5c').trim();
					const target = data.variableCategories.find((c) => c.id === id);
					if (target && name && budget >= 0) {
						target.name = name;
						target.expected_budget = budget;
						target.color = color;
					}
				}

				const newCatNames = formData.getAll('new_cat_name').map((v) => String(v ?? '').trim());
				const newCatBudgets = formData.getAll('new_cat_budget').map((v) => Number(v ?? 0));
				const newCatColors = formData
					.getAll('new_cat_color')
					.map((v) => String(v ?? '#c49a5c').trim());
				for (let i = 0; i < newCatNames.length; i++) {
					if (newCatNames[i] && (newCatBudgets[i] ?? 0) >= 0) {
						data.variableCategories.push({
							id: makeId(),
							month,
							name: newCatNames[i],
							expected_budget: newCatBudgets[i],
							color: newCatColors[i] || '#c49a5c',
							icon: 'folder',
							sort_order: data.variableCategories.length + 1
						});
					}
				}

				if (confirmAlso) {
					data.monthConfirmed = true;
				}
				await this.saveDashboardData(data);
				return { success: true, message: 'Monthly setup saved.' };
			}

			case 'addDailyExpense': {
				let category_id = String(formData.get('category_id') ?? '').trim();
				const new_category_name = String(formData.get('new_category_name') ?? '').trim();
				const new_category_budget = Number(formData.get('new_category_budget') ?? 0);
				const new_category_color = String(formData.get('new_category_color') ?? '#c49a5c').trim();

				if (category_id === '__new__') {
					if (!new_category_name) {
						return { error: 'Please provide a name for the new Semi-Fixed category.' };
					}
					const newCat: VariableCategory = {
						id: makeId(),
						month,
						name: new_category_name,
						expected_budget: new_category_budget >= 0 ? new_category_budget : 0,
						color: new_category_color,
						icon: 'folder',
						sort_order: data.variableCategories.length + 1
					};
					data.variableCategories.push(newCat);
					category_id = newCat.id;
				} else if (category_id === '__none__') {
					category_id = '';
				}

				const titles = formData.getAll('title').map((v) => String(v ?? '').trim());
				const amounts = formData.getAll('amount').map((v) => Number(v ?? 0));
				const expenseDates = formData.getAll('expense_date').map((v) => String(v ?? '').trim());
				const notes = formData.getAll('note').map((v) => String(v ?? '').trim());

				const validRows: Array<{ title: string; amount: number; expense_date: string; note: string }> =
					[];
				for (let i = 0; i < titles.length; i++) {
					const t = titles[i];
					const a = amounts[i] ?? 0;
					const d = expenseDates[i] || expenseDates[0] || `${month}-01`;
					const n = notes[i] ?? '';
					if (t && a > 0 && d) {
						validRows.push({ title: t, amount: a, expense_date: d, note: n });
					}
				}

				if (category_id === '__new__' || validRows.length === 0) {
					return { error: 'Please enter a valid expense name, date, and positive amount.' };
				}

				for (const row of validRows) {
					data.dailyExpenses.unshift({
						id: makeId(),
						category_id,
						title: row.title,
						amount: row.amount,
						expense_date: row.expense_date,
						note: row.note,
						created_at: new Date().toISOString()
					});
				}
				await this.saveDashboardData(data);
				return {
					success: true,
					message: validRows.length > 1 ? `${validRows.length} expenses logged.` : 'Expense logged.'
				};
			}

			case 'updateDailyExpense': {
				const id = String(formData.get('id') ?? '').trim();
				const title = String(formData.get('title') ?? '').trim();
				const amount = Number(formData.get('amount') ?? 0);
				const expense_date = String(formData.get('expense_date') ?? '').trim();
				const rawCategory = formData.has('category_id')
					? String(formData.get('category_id') ?? '').trim()
					: undefined;
				const category_id =
					rawCategory === undefined ? undefined : rawCategory === '__none__' ? '' : rawCategory;
				const note = formData.has('note') ? String(formData.get('note') ?? '').trim() : undefined;

				const target = data.dailyExpenses.find((e) => e.id === id);
				if (!target || !title || !(amount > 0)) {
					return { error: 'Please provide a valid expense name and positive amount.' };
				}
				target.title = title;
				target.amount = amount;
				if (expense_date) target.expense_date = expense_date;
				if (category_id !== undefined) target.category_id = category_id;
				if (note !== undefined) target.note = note;

				await this.saveDashboardData(data);
				return { success: true, message: 'Expense updated.' };
			}

			case 'deleteDailyExpense': {
				const id = String(formData.get('id') ?? '').trim();
				data.dailyExpenses = data.dailyExpenses.filter((e) => e.id !== id);
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'addIncome': {
				const names = formData.getAll('name').map((v) => String(v ?? '').trim());
				const amounts = formData.getAll('amount').map((v) => Number(v ?? 0));
				const colors = formData.getAll('color').map((v) => String(v ?? '#6b846d').trim());
				for (let i = 0; i < names.length; i++) {
					if (names[i] && (amounts[i] ?? 0) > 0) {
						data.incomes.push({
							id: makeId(),
							month,
							name: names[i],
							amount: amounts[i],
							color: colors[i] || '#6b846d',
							day_of_month: 1,
							note: '',
							active: true
						});
					}
				}
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'updateIncome': {
				const id = String(formData.get('id') ?? '').trim();
				const name = String(formData.get('name') ?? '').trim();
				const amount = Number(formData.get('amount') ?? 0);
				const color = String(formData.get('color') ?? '').trim();
				const target = data.incomes.find((i) => i.id === id);
				if (target && name && amount >= 0) {
					target.name = name;
					target.amount = amount;
					if (color) target.color = color;
					await this.saveDashboardData(data);
				}
				return { success: true };
			}

			case 'deleteIncome': {
				const id = String(formData.get('id') ?? '').trim();
				data.incomes = data.incomes.filter((i) => i.id !== id);
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'addFixedOutgoing': {
				const names = formData.getAll('name').map((v) => String(v ?? '').trim());
				const amounts = formData.getAll('amount').map((v) => Number(v ?? 0));
				const colors = formData.getAll('color').map((v) => String(v ?? '#b86b58').trim());
				for (let i = 0; i < names.length; i++) {
					if (names[i] && (amounts[i] ?? 0) > 0) {
						data.fixedOutgoings.push({
							id: makeId(),
							month,
							name: names[i],
							amount: amounts[i],
							group_tag: 'Fixed',
							color: colors[i] || '#b86b58',
							day_of_month: 1,
							note: '',
							active: true,
							split_half: false
						});
					}
				}
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'updateFixedOutgoing': {
				const id = String(formData.get('id') ?? '').trim();
				const name = String(formData.get('name') ?? '').trim();
				const amount = Number(formData.get('amount') ?? 0);
				const color = String(formData.get('color') ?? '').trim();
				const target = data.fixedOutgoings.find((f) => f.id === id);
				if (target && name && amount >= 0) {
					target.name = name;
					target.amount = amount;
					if (color) target.color = color;
					await this.saveDashboardData(data);
				}
				return { success: true };
			}

			case 'deleteFixedOutgoing': {
				const id = String(formData.get('id') ?? '').trim();
				data.fixedOutgoings = data.fixedOutgoings.filter((f) => f.id !== id);
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'toggleFixedSplit': {
				const id = String(formData.get('id') ?? '').trim();
				const split_half = formData.get('split_half') === '1';
				const target = data.fixedOutgoings.find((f) => f.id === id);
				if (target) {
					target.split_half = split_half;
					await this.saveDashboardData(data);
				}
				return { success: true };
			}

			case 'addVariableCategory': {
				const names = formData.getAll('name').map((v) => String(v ?? '').trim());
				const budgets = formData.getAll('expected_budget').map((v) => Number(v ?? 0));
				const colors = formData.getAll('color').map((v) => String(v ?? '#c49a5c').trim());
				for (let i = 0; i < names.length; i++) {
					if (names[i] && (budgets[i] ?? 0) >= 0) {
						data.variableCategories.push({
							id: makeId(),
							month,
							name: names[i],
							expected_budget: budgets[i],
							color: colors[i] || '#c49a5c',
							icon: 'folder',
							sort_order: data.variableCategories.length + 1
						});
					}
				}
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'updateVariableCategory': {
				const id = String(formData.get('id') ?? '').trim();
				const expected_budget = Number(formData.get('expected_budget') ?? 0);
				const name = String(formData.get('name') ?? '').trim();
				const color = String(formData.get('color') ?? '').trim();
				const target = data.variableCategories.find((c) => c.id === id);
				if (target && expected_budget >= 0) {
					if (name) target.name = name;
					if (color) target.color = color;
					target.expected_budget = expected_budget;
					await this.saveDashboardData(data);
				}
				return { success: true };
			}

			case 'deleteVariableCategory': {
				const id = String(formData.get('id') ?? '').trim();
				data.variableCategories = data.variableCategories.filter((c) => c.id !== id);
				data.dailyExpenses = data.dailyExpenses.filter((e) => e.category_id !== id);
				await this.saveDashboardData(data);
				return { success: true };
			}

			case 'importPreviousMonthSetup': {
				const requestedSource = String(formData.get('source_month') ?? '').trim();
				const sourceMonth = requestedSource || (await this.getPreviousPopulatedMonth(month));
				if (!sourceMonth) {
					return { error: 'No previous month setup found to import.' };
				}
				const sourceContent = await this.readFileSafe(this.getOverviewFilePath(sourceMonth));
				if (!sourceContent) {
					return { error: `Could not read data from ${formatMonthLabel(sourceMonth)}.` };
				}
				const sourceData = this.parseMarkdownData(sourceMonth, sourceContent);
				if (!sourceData) {
					return { error: `Could not parse data from ${formatMonthLabel(sourceMonth)}.` };
				}
				data.incomes = sourceData.incomes.map((i) => ({ ...i, id: makeId(), month }));
				data.fixedOutgoings = sourceData.fixedOutgoings.map((f) => ({
					...f,
					id: makeId(),
					month
				}));
				data.variableCategories = sourceData.variableCategories.map((c) => ({
					...c,
					id: makeId(),
					month
				}));
				data.carriedOverFrom = sourceMonth;
				data.monthConfirmed = false;
				await this.saveDashboardData(data);
				return {
					success: true,
					message: `Imported setup from ${formatMonthLabel(sourceMonth)}.`
				};
			}

			case 'purgeMonth': {
				data.incomes = [];
				data.fixedOutgoings = [];
				data.variableCategories = [];
				data.dailyExpenses = [];
				data.monthConfirmed = false;
				data.carriedOverFrom = null;
				await this.saveDashboardData(data);

				return {
					success: true,
					message: `Purged all entries for ${formatMonthLabel(month)}.`
				};
			}

			default:
				return { error: `Unknown action: ${actionName}` };
		}
	}
}
