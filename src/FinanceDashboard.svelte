<script lang="ts">
	import { onMount, tick } from 'svelte';
	import PieWheel from './PieWheel.svelte';
	import ThemeToggle from './ThemeToggle.svelte';
	import type { CategoryBreakdown, DashboardData, PieSlice } from './types';
	import type { MarkdownFinanceRepository } from './markdownRepository';

	let {
		initialData,
		repo,
		onMonthChange,
		onOpenMarkdown
	}: {
		initialData: DashboardData;
		repo: MarkdownFinanceRepository;
		onMonthChange?: (month: string) => void;
		onOpenMarkdown?: (month: string) => void;
	} = $props();

	let data = $state<DashboardData>(initialData);
	let form = $state<{ error?: string; success?: boolean; message?: string } | null>(null);
	let dashboardRootEl = $state<HTMLElement | null>(null);
	let viewMode = $state<'pipeline' | 'mobile-quick' | 'mobile-wheels'>('pipeline');
	let previousPopulatedMonth = $state<string | null>(null);
	let isImporting = $state(false);
	let showPurgeModal = $state(false);

	const isMonthEmpty = $derived(
		data.incomes.length === 0 &&
		data.fixedOutgoings.length === 0 &&
		data.variableCategories.length === 0 &&
		data.dailyExpenses.length === 0
	);

	async function checkPreviousMonth(month: string) {
		previousPopulatedMonth = await repo.getPreviousPopulatedMonth(month);
	}

	onMount(() => {
		const isMobileViewport =
			document.body.classList.contains('is-mobile') ||
			document.body.classList.contains('is-phone') ||
			window.innerWidth < 768;
		if (isMobileViewport) {
			viewMode = 'mobile-quick';
		}
		void checkPreviousMonth(data.month);
	});

	function scrollToTop() {
		const scrollContainer = dashboardRootEl?.closest('.efp-view-container');
		if (scrollContainer) {
			scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
		}
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	export async function reloadMonth(targetMonth?: string) {
		const m = targetMonth || data.month;
		data = await repo.getDashboardData(m);
		await checkPreviousMonth(m);
	}

	type EnhanceHandler = (input: {
		action: URL;
		formData: FormData;
		formElement: HTMLFormElement;
		submitter: HTMLElement | null;
	}) => Promise<
		| void
		| ((opts: {
				result: { type: 'success' | 'failure'; data?: Record<string, unknown> };
				update: (opts?: { reset?: boolean }) => Promise<void>;
		  }) => Promise<void>)
	> | ((opts: {
		result: { type: 'success' | 'failure'; data?: Record<string, unknown> };
		update: (opts?: { reset?: boolean }) => Promise<void>;
	}) => Promise<void>);

	function enhance(formElement: HTMLFormElement, handler?: EnhanceHandler) {
		async function onSubmit(e: SubmitEvent) {
			e.preventDefault();
			const submitter = (e.submitter as HTMLElement | null) ?? null;
			const rawAction =
				submitter?.getAttribute('formaction') || formElement.getAttribute('action') || '';
			const actionUrl = new URL(rawAction, 'http://localhost/');
			const actionName = actionUrl.search.replace(/^\?\//, '').trim();
			const formData = new FormData(formElement);
			if (submitter && submitter.getAttribute('name')) {
				formData.set(
					submitter.getAttribute('name')!,
					submitter.getAttribute('value') ?? ''
				);
			}

			let callback:
				| ((opts: {
						result: { type: 'success' | 'failure'; data?: Record<string, unknown> };
						update: (opts?: { reset?: boolean }) => Promise<void>;
				  }) => Promise<void>)
				| void = undefined;

			if (handler) {
				callback = await handler({
					action: actionUrl,
					formData,
					formElement,
					submitter
				});
			}

			const res = await repo.handleAction(actionName, formData, data.month);
			const resultType = res.error ? 'failure' : 'success';
			form = res;

			const update = async (opts?: { reset?: boolean }) => {
				if (opts?.reset !== false && !res.error) {
					formElement.reset();
				}
				data = await repo.getDashboardData(data.month);
			};

			if (typeof callback === 'function') {
				await callback({
					result: { type: resultType, data: res },
					update
				});
			} else {
				await update();
			}
		}

		formElement.addEventListener('submit', onSubmit);
		return {
			destroy() {
				formElement.removeEventListener('submit', onSubmit);
			}
		};
	}

	const mutedColors = [
		'#6b846d',
		'#b86b58',
		'#c49a5c',
		'#6b8194',
		'#8e7688',
		'#857863',
		'#a37c64',
		'#5c7a76'
	];

	function getDefaultDateForMonth(month: string): string {
		const now = new Date();
		const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
		if (month === currentYm) {
			return `${currentYm}-${String(now.getDate()).padStart(2, '0')}`;
		}
		return `${month}-01`;
	}

	// Top "+ Put In Expense" drawer state (supports 1 or multiple expense rows at once)
	let showTopExpenseForm = $state(false);
	let topCategoryId = $state('');
	let topNewCategoryName = $state('');
	let topNewCategoryBudget = $state('');
	let rowIdCounter = $state(10);
	let topExpenseRows = $state<Array<{ id: number; title: string; amount: string; date: string; note: string }>>([
		{ id: 1, title: '', amount: '', date: '', note: '' }
	]);
	let topTitleInput = $state<HTMLInputElement | null>(null);

	// Keep default date synced with viewed month
	$effect(() => {
		const defaultForMonth = getDefaultDateForMonth(data.month);
		for (const row of topExpenseRows) {
			if (!row.date || !row.date.startsWith(data.month)) {
				row.date = defaultForMonth;
			}
		}
	});

	function addTopExpenseRow() {
		rowIdCounter += 1;
		topExpenseRows.push({
			id: rowIdCounter,
			title: '',
			amount: '',
			date: getDefaultDateForMonth(data.month),
			note: ''
		});
	}

	function removeTopExpenseRow(id: number) {
		if (topExpenseRows.length > 1) {
			topExpenseRows = topExpenseRows.filter((r) => r.id !== id);
		}
	}

	function closeAndResetTopExpenseForm() {
		showTopExpenseForm = false;
		rowIdCounter += 1;
		topExpenseRows = [
			{ id: rowIdCounter, title: '', amount: '', date: getDefaultDateForMonth(data.month), note: '' }
		];
		topNewCategoryName = '';
		topNewCategoryBudget = '';
		if (data.variableCategories.length > 0) {
			topCategoryId = data.variableCategories[0].id;
		}
	}

	async function openTopExpenseForm() {
		showTopExpenseForm = true;
		await tick();
		topTitleInput?.focus();
	}

	$effect(() => {
		if (data.variableCategories.length === 0) {
			if (topCategoryId !== '__new__' && topCategoryId !== '__none__') {
				topCategoryId = '__none__';
			}
		} else if (!topCategoryId || !data.variableCategories.some((c) => c.id === topCategoryId)) {
			if (topCategoryId !== '__new__' && topCategoryId !== '__none__') {
				topCategoryId = data.variableCategories[0].id;
			}
		}
	});

	// Monthly Setup Review & Modify Panel state + multi-row draft state
	let showModifySetupModal = $state(false);
	let setupSavedFlash = $state(false);

	let setupNewIncomes = $state<Array<{ id: number; name: string; amount: string; color: string }>>([
		{ id: 1, name: '', amount: '', color: '#6b846d' }
	]);
	let setupNewFixed = $state<Array<{ id: number; name: string; amount: string; color: string }>>([
		{ id: 2, name: '', amount: '', color: '#b86b58' }
	]);
	let setupNewCats = $state<Array<{ id: number; name: string; budget: string; color: string }>>([
		{ id: 3, name: '', budget: '', color: '#c49a5c' }
	]);

	function addSetupIncomeRow() {
		rowIdCounter += 1;
		setupNewIncomes.push({
			id: rowIdCounter,
			name: '',
			amount: '',
			color: mutedColors[(activeIncomes.length + setupNewIncomes.length) % mutedColors.length]
		});
	}

	function addSetupFixedRow() {
		rowIdCounter += 1;
		setupNewFixed.push({
			id: rowIdCounter,
			name: '',
			amount: '',
			color: mutedColors[(activeFixedOutgoings.length + setupNewFixed.length + 1) % mutedColors.length]
		});
	}

	function addSetupCatRow() {
		rowIdCounter += 1;
		setupNewCats.push({
			id: rowIdCounter,
			name: '',
			budget: '',
			color: mutedColors[(data.variableCategories.length + setupNewCats.length + 2) % mutedColors.length]
		});
	}

	function resetSetupDraftRows() {
		rowIdCounter += 3;
		setupNewIncomes = [{ id: rowIdCounter - 2, name: '', amount: '', color: '#6b846d' }];
		setupNewFixed = [{ id: rowIdCounter - 1, name: '', amount: '', color: '#b86b58' }];
		setupNewCats = [{ id: rowIdCounter, name: '', budget: '', color: '#c49a5c' }];
	}

	// Stage 1, 2, 3 multi-row quick-add state + inline edit state
	let stageNewIncomes = $state<Array<{ id: number; name: string; amount: string; color: string }>>([
		{ id: 4, name: '', amount: '', color: '#6b846d' }
	]);
	let stageNewFixed = $state<Array<{ id: number; name: string; amount: string; color: string }>>([
		{ id: 5, name: '', amount: '', color: '#b86b58' }
	]);
	let stageNewCats = $state<Array<{ id: number; name: string; budget: string; color: string }>>([
		{ id: 6, name: '', budget: '', color: '#c49a5c' }
	]);

	let editingIncomeId = $state<string | null>(null);
	let editingFixedId = $state<string | null>(null);
	let editingStageCatId = $state<string | null>(null);
	let confirmingStageDeleteCatId = $state<string | null>(null);

	// Mobile ergonomics: collapse Fixed Stages 1 & 2 on phone once setup exists
	let mobileShowFixedStages = $state(false);

	let showAddIncome = $state(false);
	let showAddFixed = $state(false);
	let showAddCategory = $state(false);
	let loggingForCategoryId = $state<string | null>(null);
	let inlineExpenseDate = $state('');
	let editingCategoryId = $state<string | null>(null);
	let editingBudgetValue = $state<number>(0);

	// Safe 2-step delete confirmation for Semi-Fixed categories with expenses
	let confirmingDeleteCatId = $state<string | null>(null);

	// Expenses inside each Semi-Fixed pie card are expanded by default so remove buttons are always visible
	let collapsedCategoryIds = $state<Record<string, boolean>>({});
	let editingExpenseId = $state<string | null>(null);

	function toggleCategoryExpenses(catId: string) {
		collapsedCategoryIds[catId] = !collapsedCategoryIds[catId];
	}

	const activeIncomes = $derived(data.incomes.filter((i) => i.active));
	const activeFixedOutgoings = $derived(data.fixedOutgoings.filter((f) => f.active));

	// 1. Total Income
	const totalIncome = $derived(
		activeIncomes.reduce((sum, i) => sum + i.amount, 0)
	);

	// 2. Total Fixed Spending
	const totalFixedOutgoing = $derived(
		activeFixedOutgoings.reduce((sum, f) => sum + f.amount, 0)
	);

	// Roommate 50/50 split calculation for marked Fixed Spending items
	const sharedFixedItems = $derived(activeFixedOutgoings.filter((f) => f.split_half));
	const sharedFixedTotal = $derived(
		sharedFixedItems.reduce((sum, f) => sum + f.amount, 0)
	);
	const roommateRentShare = $derived(sharedFixedTotal / 2);

	// What is left after Fixed Spending
	const leftAfterFixed = $derived(totalIncome - totalFixedOutgoing);

	// Breakdown for each Semi-Fixed category (Budget, Used, Still Left, Effective Claim, Pie Slices)
	const categoryBreakdowns = $derived.by<CategoryBreakdown[]>(() => {
		return data.variableCategories.map((cat) => {
			const expenses = data.dailyExpenses.filter((e) => e.category_id === cat.id);
			const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
			const remaining = Math.max(0, cat.expected_budget - spent);
			const overBudget = Math.max(0, spent - cat.expected_budget);
			const effectiveClaim = Math.max(cat.expected_budget, spent);
			const percentUsed =
				cat.expected_budget > 0 ? (spent / cat.expected_budget) * 100 : spent > 0 ? 100 : 0;

			const pieSlices: PieSlice[] = [
				{
					id: `${cat.id}-budget`,
					label: cat.name,
					value: effectiveClaim > 0 ? effectiveClaim : 1,
					color: cat.color,
					spentAmount: spent,
					sublabel: `${percentUsed.toFixed(0)}% used`
				}
			];

			return {
				category: cat,
				spent,
				remaining,
				overBudget,
				effectiveClaim,
				percentUsed,
				expenses,
				pieSlices
			};
		});
	});

	// Uncategorized / Direct Minus Expenses (deducted directly from What Is Left)
	const uncategorizedExpenses = $derived(
		data.dailyExpenses.filter((e) => !e.category_id)
	);
	const totalUncategorizedSpent = $derived(
		uncategorizedExpenses.reduce((sum, e) => sum + e.amount, 0)
	);

	// 3. Semi-Fixed Outgoing Totals (only expenses inside Semi-Fixed categories)
	const totalExpectedVariable = $derived(
		data.variableCategories.reduce((sum, c) => sum + c.expected_budget, 0)
	);

	const totalActualVariable = $derived(
		categoryBreakdowns.reduce((sum, cb) => sum + cb.spent, 0)
	);

	const totalAllManualExpenses = $derived(
		data.dailyExpenses.reduce((sum, e) => sum + e.amount, 0)
	);

	const totalVariableStillLeft = $derived(
		categoryBreakdowns.reduce((sum, cb) => sum + cb.remaining, 0)
	);

	const totalOverBudget = $derived(
		categoryBreakdowns.reduce((sum, cb) => sum + cb.overBudget, 0)
	);

	const netSemiFixedBalance = $derived(totalExpectedVariable - totalActualVariable);

	const totalEffectiveSemiFixed = $derived(
		categoryBreakdowns.reduce((sum, cb) => sum + cb.effectiveClaim, 0)
	);

	// 4. What is left at the end (reduced by Semi-Fixed budgets/excess AND direct uncategorized minus expenses)
	const expectedLeftAtEnd = $derived(
		leftAfterFixed - totalEffectiveSemiFixed - totalUncategorizedSpent
	);
	const actualLeftNow = $derived(
		leftAfterFixed - totalActualVariable - totalUncategorizedSpent
	);

	const hasAnyRecurringItems = $derived(
		activeIncomes.length > 0 ||
			activeFixedOutgoings.length > 0 ||
			data.variableCategories.length > 0
	);

	const selectedTopCategoryBreakdown = $derived(
		categoryBreakdowns.find((cb) => cb.category.id === topCategoryId) ?? null
	);

	const topTotalEntered = $derived(
		topExpenseRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
	);

	const topPreviewAfterExpense = $derived.by(() => {
		if (topCategoryId === '__none__') {
			return expectedLeftAtEnd - topTotalEntered;
		}
		if (topCategoryId === '__new__') {
			const newBudget = Number(topNewCategoryBudget) || 0;
			return newBudget - topTotalEntered;
		}
		if (!selectedTopCategoryBreakdown) return null;
		return (
			selectedTopCategoryBreakdown.category.expected_budget -
			(selectedTopCategoryBreakdown.spent + topTotalEntered)
		);
	});

	// Stage 1 Pie: Income (only active incomes)
	const incomeSlices = $derived<PieSlice[]>(
		activeIncomes.map((i) => ({
			id: i.id,
			label: i.name,
			value: i.amount,
			color: i.color
		}))
	);

	// Stage 2 Pie: Fixed Spending taken from Income
	const fixedTakingSlices = $derived.by<PieSlice[]>(() => {
		const slices: PieSlice[] = activeFixedOutgoings.map((f) => ({
			id: f.id,
			label: f.name,
			value: f.amount,
			color: f.color,
			sublabel: 'Fixed'
		}));

		// Only show the remaining slice when there is at least one fixed outgoing and positive remainder
		if (totalFixedOutgoing > 0 && leftAfterFixed > 0 && totalIncome > 0) {
			slices.push({
				id: 'remaining-after-fixed',
				label: 'Left After Fixed',
				value: leftAfterFixed,
				color: 'var(--ring-left)'
			});
		}
		return slices;
	});

	// Stage 3 Pie: Semi-Fixed Budgets (1 solid color slice per category + red outer border showing how much is spent)
	const semiFixedOverviewSlices = $derived.by<PieSlice[]>(() => {
		return categoryBreakdowns.map((cb) => ({
			id: `sf-cat-${cb.category.id}`,
			label: cb.category.name,
			value: cb.effectiveClaim,
			color: cb.category.color,
			spentAmount: cb.spent,
			sublabel: `Used ${formatEUR(cb.spent)} / ${formatEUR(cb.category.expected_budget)}`
		}));
	});

	// Stage 4 Wheel: What is left at the end
	const finalWheelSlices = $derived.by<PieSlice[]>(() => {
		const slices: PieSlice[] = [];

		for (const f of activeFixedOutgoings) {
			slices.push({
				id: `final-fix-${f.id}`,
				label: `${f.name} (Fixed)`,
				value: f.amount,
				color: f.color
			});
		}

		for (const cb of categoryBreakdowns) {
			slices.push({
				id: `final-sf-${cb.category.id}`,
				label: `${cb.category.name} (Semi-Fixed)`,
				value: cb.effectiveClaim,
				color: cb.category.color,
				spentAmount: cb.spent,
				sublabel: `Used ${formatEUR(cb.spent)}`
			});
		}

		for (const exp of uncategorizedExpenses) {
			slices.push({
				id: `final-uncat-${exp.id}`,
				label: `${exp.title} (Minus Expense)`,
				value: exp.amount,
				color: '#b86b58'
			});
		}

		if (expectedLeftAtEnd > 0) {
			slices.push({
				id: 'final-what-is-left',
				label: 'What Is Left',
				value: expectedLeftAtEnd,
				color: '#6b846d'
			});
		}

		return slices;
	});

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

	async function importPreviousMonthSetup() {
		if (!previousPopulatedMonth) return;
		isImporting = true;
		const fd = new FormData();
		fd.set('month', data.month);
		fd.set('source_month', previousPopulatedMonth);
		const res = await repo.handleAction('importPreviousMonthSetup', fd, data.month);
		form = res;
		data = await repo.getDashboardData(data.month);
		isImporting = false;
	}

	async function purgeCurrentMonth() {
		const fd = new FormData();
		fd.set('month', data.month);
		const res = await repo.handleAction('purgeMonth', fd, data.month);
		form = res;
		showPurgeModal = false;
		data = await repo.getDashboardData(data.month);
		await checkPreviousMonth(data.month);
	}

	async function changeMonth(delta: number) {
		const [year, month] = data.month.split('-').map(Number);
		const d = new Date(year, month - 1 + delta, 1);
		const nextYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		data = await repo.getDashboardData(nextYm);
		form = null;
		onMonthChange?.(nextYm);
		await checkPreviousMonth(nextYm);
	}
</script>

<div bind:this={dashboardRootEl} class="efp-root min-h-full w-full"><div class="mx-auto max-w-[1600px] px-4 pt-6 pb-28 sm:px-6 lg:px-8">
	<!-- HEADER WITH IMMEDIATE "+ PUT IN EXPENSE", VIEW SWITCHER & "MODIFY SETUP" BUTTONS -->
	<header
		class="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-main)] pb-4"
	>
		<div class="flex flex-wrap items-center gap-2.5">
			<h1 class="text-xl font-bold tracking-tight text-[var(--text-main)]">
				Cashflow Pipeline
			</h1>

			<!-- PRIMARY TOP BUTTON TO IMMEDIATELY PUT IN AN EXPENSE -->
			<button
				type="button"
				onclick={() => {
					if (viewMode === 'mobile-quick') {
						scrollToTop();
						topTitleInput?.focus();
					} else if (showTopExpenseForm) {
						closeAndResetTopExpenseForm();
					} else {
						openTopExpenseForm();
					}
				}}
				class="inline-flex items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 py-2 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
			>
				<span>{showTopExpenseForm && viewMode !== 'mobile-quick' ? '✕ Cancel Expense' : '+ Put In Expense'}</span>
			</button>

			<!-- BUTTON TO REVIEW / MODIFY THIS MONTH'S INCOME, FIXED & SEMI-FIXED ITEMS -->
			<button
				type="button"
				onclick={() => (showModifySetupModal = !showModifySetupModal)}
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
			>
				<span>{showModifySetupModal ? '✕ Close Setup List' : '✎ Modify Monthly Setup'}</span>
			</button>

			<!-- BUTTON TO PURGE ALL ENTRIES FOR THIS MONTH (OPENS CONFIRMATION MODAL) -->
			<button
				type="button"
				onclick={() => (showPurgeModal = true)}
				class="inline-flex items-center gap-1 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-xs font-semibold text-[var(--text-muted)] transition hover:border-[var(--accent-red)] hover:text-[var(--accent-red)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
				title="Purge all entries for {formatMonthLabel(data.month)}"
			>
				<span>🗑 Purge Month</span>
			</button>
		</div>

		<div class="flex flex-wrap items-center gap-2.5">
			<!-- VIEW MODE SWITCHER (Mobile Quick Add & Left / All Wheels Stacked / 4-Col Pipeline) -->
			<div class="flex items-center rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-1">
				<button
					type="button"
					onclick={() => (viewMode = 'mobile-quick')}
					class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {viewMode === 'mobile-quick'
						? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
						: 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
					title="Mobile Quick View: Instant expense entry + What Is Left for Semi-Fixed Outgoings"
				>
					⚡ Quick & Left
				</button>
				<button
					type="button"
					onclick={() => (viewMode = 'mobile-wheels')}
					class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {viewMode === 'mobile-wheels'
						? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
						: 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
					title="All Wheels View: All pipeline & category wheels stacked vertically below each other"
				>
					🎡 All Wheels ↓
				</button>
				<button
					type="button"
					onclick={() => (viewMode = 'pipeline')}
					class="rounded-lg px-2.5 py-1 text-xs font-semibold transition {viewMode === 'pipeline'
						? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
						: 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
					title="Full 4-Column Desktop Pipeline"
				>
					🖥 Pipeline
				</button>
			</div>

			<ThemeToggle />

			<div class="flex items-center rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] p-1">
				<button
					type="button"
					onclick={() => changeMonth(-1)}
					aria-label="Previous month"
					class="rounded-lg px-2.5 py-1 text-sm text-[var(--text-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
				>
					←
				</button>
				<span class="min-w-[135px] text-center text-xs font-semibold text-[var(--text-main)]">
					{formatMonthLabel(data.month)}
				</span>
				<button
					type="button"
					onclick={() => changeMonth(1)}
					aria-label="Next month"
					class="rounded-lg px-2.5 py-1 text-sm text-[var(--text-muted)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
				>
					→
				</button>
			</div>

			<button
				type="button"
				onclick={() => onOpenMarkdown?.(data.month)}
				class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
				title="Open finances/{data.month.split('-')[0]}/{data.month.split('-')[1]}/{data.month}-Overview.md"
			>
				<span>📄 Open Markdown Note</span>
			</button>
		</div>
	</header>

	<!-- ERROR OR STATUS FEEDBACK BANNER -->
	{#if form?.error}
		<div
			role="alert"
			class="mb-6 flex items-center justify-between rounded-xl border border-[var(--accent-red)] bg-[var(--bg-card)] px-4 py-3 text-xs font-semibold text-[var(--accent-red)]"
		>
			<span>{form.error}</span>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- EMPTY MONTH BANNER (ONLY SHOWS WHEN MONTH HAS ZERO ENTRIES)               -->
	<!-- ========================================================================= -->
	{#if isMonthEmpty}
		<div class="mb-8 rounded-2xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--bg-card)] p-8 text-center shadow-xs">
			<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--btn-primary-bg)]/15 text-2xl text-[var(--accent-green)]">
				📥
			</div>
			<h2 class="text-base font-bold text-[var(--text-main)]">
				{formatMonthLabel(data.month)} is Empty
			</h2>
			<p class="mx-auto mt-1 max-w-md text-xs text-[var(--text-muted)]">
				{#if previousPopulatedMonth}
					Would you like to import your Income, Fixed Spending, and Semi-Fixed setup from <strong>{formatMonthLabel(previousPopulatedMonth)}</strong>?
				{:else}
					No previous month setup found. Click "+ Put In Expense" or "✎ Modify Monthly Setup" to start tracking this month.
				{/if}
			</p>

			<div class="mt-5 flex flex-wrap items-center justify-center gap-3">
				{#if previousPopulatedMonth}
					<button
						type="button"
						onclick={importPreviousMonthSetup}
						disabled={isImporting}
						class="inline-flex items-center gap-2 rounded-xl bg-[var(--btn-primary-bg)] px-5 py-2.5 text-xs font-bold text-[var(--btn-primary-fg)] shadow-sm transition hover:opacity-90 disabled:opacity-50"
					>
						<span>{isImporting ? '⏳ Importing Setup...' : `📥 Import Setup from ${formatMonthLabel(previousPopulatedMonth)}`}</span>
					</button>
				{/if}
				<button
					type="button"
					onclick={() => (showModifySetupModal = true)}
					class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-4 py-2.5 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-card)]"
				>
					<span>✎ Setup Manually</span>
				</button>
			</div>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- PURGE CONFIRMATION MODAL                                                  -->
	<!-- ========================================================================= -->
	{#if showPurgeModal}
		<div
			class="efp-modal-backdrop"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => {
				if (e.target === e.currentTarget) showPurgeModal = false;
			}}
			onkeydown={(e) => {
				if (e.key === 'Escape') showPurgeModal = false;
			}}
		>
			<div class="efp-modal-box">
				<div class="mb-3 flex items-center gap-2.5 text-base font-bold text-[var(--accent-red)]">
					<span class="text-xl">⚠️</span>
					<span>Purge All Entries for {formatMonthLabel(data.month)}?</span>
				</div>
				<p class="mb-5 text-xs leading-relaxed text-[var(--text-muted)]">
					This will permanently delete <strong>all Income</strong>, <strong>Fixed Spending</strong>, <strong>Semi-Fixed Categories</strong>, and <strong>logged Expenses</strong> for {formatMonthLabel(data.month)}.
					This action cannot be undone.
				</p>
				<div class="flex items-center justify-end gap-3">
					<button
						type="button"
						onclick={() => (showPurgeModal = false)}
						class="efp-btn-secondary"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={purgeCurrentMonth}
						class="efp-btn-danger"
					>
						🗑 Yes, Purge Entire Month
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- MONTHLY CARRY-OVER PROMPT BANNER (Scoped to this month only!)            -->
	<!-- ========================================================================= -->
	{#if !data.monthConfirmed && hasAnyRecurringItems}
		<div
			class="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg-card)] px-5 py-3.5 shadow-xs"
		>
			<div>
				<div class="text-sm font-bold text-[var(--text-main)]">
					{formatMonthLabel(data.month)}: Continue with this Income, Fixed & Semi-Fixed setup?
				</div>
				<div class="text-xs text-[var(--text-muted)]">
					{#if data.carriedOverFrom}
						Carried over from {formatMonthLabel(data.carriedOverFrom)} ·
					{/if}
					Changes you make here apply only to {formatMonthLabel(data.month)} and will not alter past months.
				</div>
			</div>

			<div class="flex items-center gap-2.5">
				<form method="POST" action="?/confirmMonth" use:enhance>
					<input type="hidden" name="month" value={data.month} />
					<button
						type="submit"
						class="rounded-xl bg-[#6b846d] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90"
					>
						✓ Continue With Current Setup
					</button>
				</form>

				<button
					type="button"
					onclick={() => (showModifySetupModal = true)}
					class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
				>
					✎ No, Modify Items
				</button>
			</div>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- MODIFY MONTHLY SETUP PANEL (Unified Batch Save + Multi-Row Add + Delete)  -->
	<!-- ========================================================================= -->
	{#if showModifySetupModal}
		<section
			class="mb-8 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg-card)] p-5 shadow-md"
		>
			<form
				method="POST"
				action="?/saveBatchSetup"
				use:enhance={({ action, submitter }) => {
					const shouldClose = submitter?.getAttribute('data-close') === '1';
					return async ({ result, update }) => {
						const isBatchSave = action.search.includes('saveBatchSetup');
						if (result.type === 'success' && isBatchSave) {
							resetSetupDraftRows();
							if (shouldClose) {
								showModifySetupModal = false;
							} else {
								setupSavedFlash = true;
								setTimeout(() => {
									setupSavedFlash = false;
								}, 2500);
							}
						}
						await update({ reset: false });
					};
				}}
			>
				<input type="hidden" name="month" value={data.month} />
				<input type="hidden" name="confirm_also" value="1" />

				<!-- Hidden default submit button so pressing Enter in any input saves immediately -->
				<button type="submit" class="sr-only" tabindex="-1" aria-hidden="true">Save</button>

				<div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
					<div>
						<div class="flex items-center gap-2.5">
							<h2 class="text-base font-bold text-[var(--text-main)]">
								Modify Setup for {formatMonthLabel(data.month)}
							</h2>
							{#if setupSavedFlash}
								<span class="rounded-lg bg-[#6b846d]/20 px-2.5 py-0.5 text-xs font-bold text-[var(--accent-green)]">
									✓ Saved!
								</span>
							{/if}
						</div>
						<p class="text-xs text-[var(--text-muted)]">
							Press Enter or click Save in any column to save your items. Use "+ Add Another Row" to add multiple items at once.
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="submit"
							class="rounded-xl bg-[var(--btn-primary-bg)] px-4 py-1.5 text-xs font-bold text-[var(--btn-primary-fg)] transition hover:opacity-90"
						>
							✓ Save Changes
						</button>
						<button
							type="submit"
							data-close="1"
							class="rounded-xl bg-[#6b846d] px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
						>
							✓ Save All & Close
						</button>
						<button
							type="button"
							onclick={() => (showModifySetupModal = false)}
							class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-main)]"
						>
							✕ Close
						</button>
					</div>
				</div>

				<div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
					<!-- 1. MODIFY INCOMES -->
					<div class="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 p-3.5">
						<div class="space-y-2">
							<h3 class="text-xs font-bold tracking-wider text-[var(--accent-green)] uppercase">
								1. Income Items ({activeIncomes.length})
							</h3>
							{#if activeIncomes.length === 0}
								<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-faint)]">
									No income sources yet. Add below.
								</p>
							{/if}
							{#each activeIncomes as inc (inc.id)}
								<div class="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
									<input type="hidden" name="income_id" value={inc.id} />
									<input
										type="color"
										name="income_color_{inc.id}"
										value={inc.color}
										aria-label="Color for {inc.name}"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
									/>
									<input
										type="text"
										name="income_name_{inc.id}"
										value={inc.name}
										required
										aria-label="Income name"
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="income_amount_{inc.id}"
										value={inc.amount}
										required
										aria-label="Income amount"
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<button
										type="submit"
										formaction="?/deleteIncome"
										name="id"
										value={inc.id}
										formnovalidate
										aria-label="Delete {inc.name}"
										title="Delete {inc.name}"
										class="shrink-0 rounded-lg px-1.5 py-1 text-xs text-[var(--text-faint)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--accent-red)]"
									>
										✕
									</button>
								</div>
							{/each}

							<div class="pt-2">
								<div class="mb-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
									Add New Income(s):
								</div>
								<div class="space-y-2">
									{#each setupNewIncomes as row (row.id)}
										<div class="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-main)] bg-[var(--bg-card)] p-2">
											<input
												type="color"
												name="new_income_color"
												bind:value={row.color}
												aria-label="New income color"
												class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
											/>
											<input
												type="text"
												name="new_income_name"
												bind:value={row.name}
												placeholder="Income name (e.g. Salary)"
												aria-label="New income name"
												class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											<input
												type="number"
												step="0.01"
												min="0"
												name="new_income_amount"
												bind:value={row.amount}
												placeholder="Amount €"
												aria-label="New income amount"
												class="w-24 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											{#if setupNewIncomes.length > 1}
												<button
													type="button"
													onclick={() => (setupNewIncomes = setupNewIncomes.filter((r) => r.id !== row.id))}
													aria-label="Remove draft row"
													class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
												>
													✕
												</button>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>

						<div class="mt-3 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
							<button
								type="button"
								onclick={addSetupIncomeRow}
								class="flex-1 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)]"
							>
								+ Add Another Row
							</button>
							<button
								type="submit"
								class="rounded-xl bg-[#6b846d] px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
							>
								✓ Save Income
							</button>
						</div>
					</div>

					<!-- 2. MODIFY FIXED SPENDING -->
					<div class="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 p-3.5">
						<div class="space-y-2">
							<h3 class="text-xs font-bold tracking-wider text-[var(--accent-red)] uppercase">
								2. Fixed Spending ({activeFixedOutgoings.length})
							</h3>
							{#if activeFixedOutgoings.length === 0}
								<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-faint)]">
									No fixed spending items yet. Add below.
								</p>
							{/if}
							{#each activeFixedOutgoings as fix (fix.id)}
								<div class="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
									<input type="hidden" name="fixed_id" value={fix.id} />
									<input
										type="checkbox"
										name="fixed_split_{fix.id}"
										value="1"
										checked={Boolean(fix.split_half)}
										aria-label="Split {fix.name} 50/50 with roommate"
										title="Mark to include in 50/50 roommate rent calculation"
										class="h-4 w-4 shrink-0 cursor-pointer rounded border-[var(--border-main)] accent-[var(--accent-ochre)]"
									/>
									<input
										type="color"
										name="fixed_color_{fix.id}"
										value={fix.color}
										aria-label="Color for {fix.name}"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
									/>
									<input
										type="text"
										name="fixed_name_{fix.id}"
										value={fix.name}
										required
										aria-label="Fixed spending name"
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="fixed_amount_{fix.id}"
										value={fix.amount}
										required
										aria-label="Fixed spending amount"
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<button
										type="submit"
										formaction="?/deleteFixedOutgoing"
										name="id"
										value={fix.id}
										formnovalidate
										aria-label="Delete {fix.name}"
										title="Delete {fix.name}"
										class="shrink-0 rounded-lg px-1.5 py-1 text-xs text-[var(--text-faint)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--accent-red)]"
									>
										✕
									</button>
								</div>
							{/each}

							<div class="pt-2">
								<div class="mb-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
									Add New Fixed Expense(s):
								</div>
								<div class="space-y-2">
									{#each setupNewFixed as row (row.id)}
										<div class="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-main)] bg-[var(--bg-card)] p-2">
											<input
												type="color"
												name="new_fixed_color"
												bind:value={row.color}
												aria-label="New fixed spending color"
												class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
											/>
											<input
												type="text"
												name="new_fixed_name"
												bind:value={row.name}
												placeholder="Fixed bill (e.g. Rent)"
												aria-label="New fixed spending name"
												class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											<input
												type="number"
												step="0.01"
												min="0"
												name="new_fixed_amount"
												bind:value={row.amount}
												placeholder="Amount €"
												aria-label="New fixed spending amount"
												class="w-24 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											{#if setupNewFixed.length > 1}
												<button
													type="button"
													onclick={() => (setupNewFixed = setupNewFixed.filter((r) => r.id !== row.id))}
													aria-label="Remove draft row"
													class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
												>
													✕
												</button>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>

						<div class="mt-3 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
							<button
								type="button"
								onclick={addSetupFixedRow}
								class="flex-1 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)]"
							>
								+ Add Another Row
							</button>
							<button
								type="submit"
								class="rounded-xl bg-[#b86b58] px-4 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
							>
								✓ Save Fixed
							</button>
						</div>
					</div>

					<!-- 3. MODIFY SEMI-FIXED CATEGORIES -->
					<div class="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 p-3.5">
						<div class="space-y-2">
							<h3 class="text-xs font-bold tracking-wider text-[var(--accent-ochre)] uppercase">
								3. Semi-Fixed Budgets ({data.variableCategories.length})
							</h3>
							{#if data.variableCategories.length === 0}
								<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-faint)]">
									No semi-fixed categories yet. Add below.
								</p>
							{/if}
							{#each data.variableCategories as cat (cat.id)}
								<div class="flex items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-2">
									<input type="hidden" name="cat_id" value={cat.id} />
									<input
										type="color"
										name="cat_color_{cat.id}"
										value={cat.color}
										aria-label="Color for {cat.name}"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
									/>
									<input
										type="text"
										name="cat_name_{cat.id}"
										value={cat.name}
										required
										aria-label="Category name"
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="cat_budget_{cat.id}"
										value={cat.expected_budget}
										required
										aria-label="Category monthly budget"
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									{#if confirmingDeleteCatId === cat.id}
										<button
											type="submit"
											formaction="?/deleteVariableCategory"
											name="id"
											value={cat.id}
											formnovalidate
											class="shrink-0 rounded bg-[var(--accent-red)] px-1.5 py-1 text-[10px] font-bold text-white"
										>
											Confirm
										</button>
										<button
											type="button"
											onclick={() => (confirmingDeleteCatId = null)}
											class="shrink-0 rounded border border-[var(--border-main)] px-1.5 py-1 text-[10px] text-[var(--text-muted)]"
										>
											No
										</button>
									{:else}
										<button
											type="button"
											onclick={() => (confirmingDeleteCatId = cat.id)}
											aria-label="Delete {cat.name}"
											title="Delete {cat.name}"
											class="shrink-0 rounded-lg px-1.5 py-1 text-xs text-[var(--text-faint)] transition hover:bg-[var(--bg-subtle)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							{/each}

							<div class="pt-2">
								<div class="mb-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
									Add New Semi-Fixed Category(s):
								</div>
								<div class="space-y-2">
									{#each setupNewCats as row (row.id)}
										<div class="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border-main)] bg-[var(--bg-card)] p-2">
											<input
												type="color"
												name="new_cat_color"
												bind:value={row.color}
												aria-label="New category color"
												class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-subtle)] p-0.5"
											/>
											<input
												type="text"
												name="new_cat_name"
												bind:value={row.name}
												placeholder="Category (e.g. Food)"
												aria-label="New category name"
												class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											<input
												type="number"
												step="0.01"
												min="0"
												name="new_cat_budget"
												bind:value={row.budget}
												placeholder="Budget €"
												aria-label="New category budget"
												class="w-24 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-2 py-1 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
											/>
											{#if setupNewCats.length > 1}
												<button
													type="button"
													onclick={() => (setupNewCats = setupNewCats.filter((r) => r.id !== row.id))}
													aria-label="Remove draft row"
													class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
												>
													✕
												</button>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						</div>

						<div class="mt-3 flex items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
							<button
								type="button"
								onclick={addSetupCatRow}
								class="flex-1 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)]"
							>
								+ Add Another Row
							</button>
							<button
								type="submit"
								class="rounded-xl bg-[var(--btn-primary-bg)] px-4 py-1.5 text-xs font-bold text-[var(--btn-primary-fg)] transition hover:opacity-90"
							>
								✓ Save Budgets
							</button>
						</div>
					</div>
				</div>
			</form>
		</section>
	{/if}

	<!-- ========================================================================= -->
	<!-- IMMEDIATE TOP EXPENSE ENTRY PANEL (Supports 1 or Multiple Rows at Once!)  -->
	<!-- ========================================================================= -->
	{#if showTopExpenseForm}
		<section
			class="mb-8 rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg-card)] p-5 shadow-sm"
		>
			<div class="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
				<h2 class="text-sm font-bold text-[var(--text-main)]">Put In Expense</h2>
				<button
					type="button"
					onclick={closeAndResetTopExpenseForm}
					class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-3 py-1 text-xs font-semibold text-[var(--text-main)] hover:opacity-85"
				>
					✕ Cancel
				</button>
			</div>

			<form
				method="POST"
				action="?/addDailyExpense"
				use:enhance={() => {
					return async ({ result, update }) => {
						if (result.type === 'success') {
							closeAndResetTopExpenseForm();
						}
						await update();
					};
				}}
				class="space-y-4"
			>
				<input type="hidden" name="month" value={data.month} />

				<div>
					<label for="top-cat" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
						Category (or No Category for What Is Left)
					</label>
					<select
						id="top-cat"
						name="category_id"
						bind:value={topCategoryId}
						required
						class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-3 py-2.5 text-sm text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none sm:max-w-md"
					>
						{#each categoryBreakdowns as cb (cb.category.id)}
							<option value={cb.category.id}>
								{cb.category.name} ({formatEUR(cb.remaining)} left)
							</option>
						{/each}
						<option value="__none__">No Category — Deduct from What Is Left (Minus Expense)</option>
						<option value="__new__">+ Create New Semi-Fixed Category...</option>
					</select>
				</div>

				<!-- If creating a new Semi-Fixed category on the fly -->
				{#if topCategoryId === '__new__'}
					<div
						class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3"
					>
						<div class="mb-2 flex items-center justify-between">
							<span class="text-xs font-bold text-[var(--text-main)]">New Semi-Fixed Category</span>
							{#if data.variableCategories.length > 0}
								<button
									type="button"
									onclick={() => (topCategoryId = data.variableCategories[0].id)}
									class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-0.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
								>
									Cancel New Category
								</button>
							{/if}
						</div>
						<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
							<div>
								<label for="new-cat-name" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Category Name
								</label>
								<input
									id="new-cat-name"
									type="text"
									name="new_category_name"
									bind:value={topNewCategoryName}
									placeholder="e.g. Food"
									required
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text-main)]"
								/>
							</div>
							<div>
								<label for="new-cat-budget" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Monthly Budget (€)
								</label>
								<input
									id="new-cat-budget"
									type="number"
									step="0.01"
									min="0"
									name="new_category_budget"
									bind:value={topNewCategoryBudget}
									placeholder="e.g. 400"
									required
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 font-mono text-xs text-[var(--text-main)]"
								/>
							</div>
							<div>
								<label for="new-cat-color" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Color
								</label>
								<input
									id="new-cat-color"
									type="color"
									name="new_category_color"
									value={mutedColors[(data.variableCategories.length + 2) % mutedColors.length]}
									class="h-8 w-full cursor-pointer rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
								/>
							</div>
						</div>
					</div>
				{/if}

				<!-- Expense Rows (1 or Multiple) -->
				<div class="space-y-2.5">
					{#each topExpenseRows as row, idx (row.id)}
						<div class="grid grid-cols-1 gap-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-2.5 sm:grid-cols-12 sm:items-end">
							<div class="sm:col-span-4">
								<label for="top-title-{row.id}" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Expense {topExpenseRows.length > 1 ? `#${idx + 1}` : ''}
								</label>
								{#if idx === 0}
									<input
										id="top-title-{row.id}"
										bind:this={topTitleInput}
										type="text"
										name="title"
										bind:value={row.title}
										placeholder="What did you spend on?"
										required
										class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
								{:else}
									<input
										id="top-title-{row.id}"
										type="text"
										name="title"
										bind:value={row.title}
										placeholder="What did you spend on?"
										required
										class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
								{/if}
							</div>

							<div class="sm:col-span-2">
								<label for="top-amount-{row.id}" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Amount (€)
								</label>
								<input
									id="top-amount-{row.id}"
									type="number"
									step="0.01"
									min="0.01"
									name="amount"
									bind:value={row.amount}
									placeholder="0.00"
									required
									class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 font-mono text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
								/>
							</div>

							<div class="sm:col-span-3">
								<label for="top-date-{row.id}" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
									Date
								</label>
								<input
									id="top-date-{row.id}"
									type="date"
									name="expense_date"
									bind:value={row.date}
									required
									class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 font-mono text-sm text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
								/>
							</div>

							<div class="flex items-center gap-1.5 sm:col-span-3">
								<div class="w-full">
									<label for="top-note-{row.id}" class="mb-1 block text-xs font-semibold text-[var(--text-muted)]">
										Note (Optional)
									</label>
									<input
										id="top-note-{row.id}"
										type="text"
										name="note"
										bind:value={row.note}
										placeholder="Optional note"
										class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text-main)] placeholder-[var(--text-faint)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
								</div>
								{#if topExpenseRows.length > 1}
									<button
										type="button"
										onclick={() => removeTopExpenseRow(row.id)}
										aria-label="Remove expense row"
										class="mt-5 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--accent-red)]"
									>
										✕
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				<!-- Bottom Bar: Live Budget Readout + Add Another Row + Save & Cancel Buttons -->
				<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
					<div class="text-xs">
						{#if topCategoryId === '__none__'}
							<div class="flex flex-wrap items-center gap-4 font-mono">
								<span class="text-[var(--text-muted)]">
									What Is Left Now:
									<strong class="text-[var(--text-main)]">{formatEUR(expectedLeftAtEnd)}</strong>
								</span>
								{#if topTotalEntered > 0 && topPreviewAfterExpense !== null}
									<span class="font-bold">
										→ What Is Left After This:
										<strong class={topPreviewAfterExpense < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}>
											{formatEUR(topPreviewAfterExpense)}
										</strong>
									</span>
								{/if}
							</div>
						{:else if selectedTopCategoryBreakdown}
							<div class="flex flex-wrap items-center gap-4 font-mono">
								<span class="text-[var(--text-muted)]">
									{selectedTopCategoryBreakdown.category.name} Budget:
									<strong class="text-[var(--text-main)]">{formatEUR(selectedTopCategoryBreakdown.category.expected_budget)}</strong>
								</span>
								<span class="text-[var(--text-muted)]">
									Used: <strong class="text-[var(--accent-red)]">{formatEUR(selectedTopCategoryBreakdown.spent)}</strong>
								</span>
								<span class="text-[var(--text-muted)]">
									Still Left: <strong class="text-[var(--accent-green)]">{formatEUR(selectedTopCategoryBreakdown.remaining)}</strong>
								</span>
								{#if topTotalEntered > 0 && topPreviewAfterExpense !== null}
									<span class="font-bold">
										→ Left After This:
										<strong class={topPreviewAfterExpense < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}>
											{formatEUR(topPreviewAfterExpense)}
										</strong>
									</span>
								{/if}
							</div>
						{/if}
					</div>

					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							onclick={addTopExpenseRow}
							class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-3.5 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
						>
							+ Add Another Expense Row
						</button>
						<button
							type="button"
							onclick={closeAndResetTopExpenseForm}
							class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
						>
							Cancel
						</button>
						<button
							type="submit"
							class="rounded-xl bg-[var(--btn-primary-bg)] px-5 py-2 text-xs font-bold text-[var(--btn-primary-fg)] transition hover:opacity-90"
						>
							✓ Save {topExpenseRows.length > 1 ? `${topExpenseRows.length} Expenses` : 'Expense'}
						</button>
					</div>
				</div>
			</form>
		</section>
	{/if}

	<!-- ========================================================================= -->
	<!-- MOBILE QUICK VIEW: 1-TAP ADD EXPENSE + SEMI-FIXED WHAT IS LEFT            -->
	<!-- ========================================================================= -->
	{#if viewMode === 'mobile-quick'}
		<div class="mx-auto max-w-md space-y-4">
			<!-- 1. QUICK ADD EXPENSE CARD (Always open in Mobile Quick View) -->
			<section class="rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg-card)] p-4 shadow-sm">
				<div class="mb-3 flex items-center justify-between">
					<h2 class="text-sm font-bold text-[var(--text-main)]">⚡ Quick Add Expense</h2>
					<span class="font-mono text-xs font-semibold text-[var(--accent-green)]">
						Semi-Fixed Left: {formatEUR(totalVariableStillLeft)}
					</span>
				</div>

				<form
					method="POST"
					action="?/addDailyExpense"
					use:enhance={() => {
						return async ({ result, update }) => {
							if (result.type === 'success') {
								rowIdCounter += 1;
								topExpenseRows = [
									{
										id: rowIdCounter,
										title: '',
										amount: '',
										date: getDefaultDateForMonth(data.month),
										note: ''
									}
								];
								topNewCategoryName = '';
								topNewCategoryBudget = '';
							}
							await update();
						};
					}}
					class="space-y-3"
				>
					<input type="hidden" name="month" value={data.month} />
					<input type="hidden" name="category_id" value={topCategoryId} />

					<!-- 1-Tap Category Pills showing What Is Left -->
					<div class="space-y-1.5">
						<span class="block text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
							1. Pick Category (Shows What Is Left)
						</span>
						<div class="flex flex-wrap gap-1.5">
							{#each categoryBreakdowns as cb (cb.category.id)}
								{@const isSelected = topCategoryId === cb.category.id}
								<button
									type="button"
									onclick={() => (topCategoryId = cb.category.id)}
									class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition {isSelected
										? 'border-[var(--border-strong)] bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-xs'
										: 'border-[var(--border-main)] bg-[var(--bg-item)] text-[var(--text-main)] hover:bg-[var(--bg-subtle)]'}"
								>
									<span
										class="h-2.5 w-2.5 shrink-0 rounded-full"
										style="background-color: {cb.category.color}"
									></span>
									<span>{cb.category.name}</span>
									<span class="font-mono text-[11px] {isSelected ? 'text-[var(--btn-primary-fg)]' : cb.overBudget > 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
										· {cb.overBudget > 0 ? `-${formatEUR(cb.overBudget)}` : `${formatEUR(cb.remaining)} left`}
									</span>
								</button>
							{/each}

							<button
								type="button"
								onclick={() => (topCategoryId = '__none__')}
								class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition {topCategoryId === '__none__'
									? 'border-[var(--border-strong)] bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] shadow-xs'
									: 'border-[var(--border-main)] bg-[var(--bg-item)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}"
							>
								<span>⊖ What Is Left (Minus)</span>
							</button>
						</div>
					</div>

					<!-- Expense Name, Amount & Date -->
					<div class="space-y-2">
						{#each topExpenseRows as row, idx (row.id)}
							<div class="space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2.5">
								<div class="flex gap-2">
									{#if idx === 0}
										<input
											bind:this={topTitleInput}
											type="text"
											name="title"
											bind:value={row.title}
											placeholder="Expense (e.g. REWE, Coffee, Train)"
											required
											class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
										/>
									{:else}
										<input
											type="text"
											name="title"
											bind:value={row.title}
											placeholder="Expense name"
											required
											class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
										/>
									{/if}
									<input
										type="number"
										step="0.01"
										min="0.01"
										inputmode="decimal"
										name="amount"
										bind:value={row.amount}
										placeholder="€"
										required
										class="w-24 shrink-0 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-2 font-mono text-xs font-bold text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
								</div>
								<div class="flex items-center gap-2">
									<input
										type="date"
										name="expense_date"
										bind:value={row.date}
										required
										class="w-36 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-[11px] text-[var(--text-main)]"
									/>
									<input
										type="text"
										name="note"
										bind:value={row.note}
										placeholder="Note (optional)"
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
									/>
									{#if topExpenseRows.length > 1}
										<button
											type="button"
											onclick={() => removeTopExpenseRow(row.id)}
											class="shrink-0 px-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>

					{#if topPreviewAfterExpense !== null && topTotalEntered > 0}
						<div class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] px-3 py-2 text-xs">
							<span class="text-[var(--text-muted)]">
								{topCategoryId === '__none__'
									? 'What Is Left after expense:'
									: `Still left in ${selectedTopCategoryBreakdown?.category.name ?? 'category'}:`}
							</span>
							<span class="font-mono font-bold {topPreviewAfterExpense < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
								{formatEUR(topPreviewAfterExpense)}
							</span>
						</div>
					{/if}

					<div class="flex items-center gap-2">
						<button
							type="button"
							onclick={addTopExpenseRow}
							class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] px-3 py-2.5 text-xs font-semibold text-[var(--text-main)]"
						>
							+ Row
						</button>
						<button
							type="submit"
							class="flex-1 rounded-xl bg-[var(--btn-primary-bg)] py-2.5 text-xs font-bold text-[var(--btn-primary-fg)] shadow-xs transition hover:opacity-90"
						>
							✓ Save {topExpenseRows.length > 1 ? `${topExpenseRows.length} Expenses` : 'Expense'}
						</button>
					</div>
				</form>
			</section>

			<!-- 2. WHAT IS LEFT FOR SEMI-FIXED OUTGOINGS SUMMARY + CARDS -->
			<section class="rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 shadow-xs">
				<div class="mb-3 flex items-center justify-between border-b border-[var(--border-subtle)] pb-2.5">
					<div>
						<h2 class="text-sm font-bold text-[var(--text-main)]">
							Semi-Fixed Outgoings — What Is Left
						</h2>
						<p class="text-[11px] text-[var(--text-muted)]">
							Used {formatEUR(totalActualVariable)} of {formatEUR(totalExpectedVariable)} budget
						</p>
					</div>
					<div class="text-right">
						<div class="font-mono text-base font-bold {netSemiFixedBalance < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
							{formatEUR(totalVariableStillLeft)} left
						</div>
						<div class="font-mono text-[10px] text-[var(--text-muted)]">
							What Is Left: {formatEUR(expectedLeftAtEnd)}
						</div>
					</div>
				</div>

				<div class="space-y-3">
					{#each categoryBreakdowns as cb (cb.category.id)}
						{@const isOver = cb.overBudget > 0}
						<div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] p-3">
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-2">
									<span
										class="h-3 w-3 shrink-0 rounded-full"
										style="background-color: {cb.category.color}"
									></span>
									<span class="text-sm font-bold text-[var(--text-main)]">{cb.category.name}</span>
								</div>
								<span class="font-mono text-sm font-bold {isOver ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
									{isOver ? `-${formatEUR(cb.overBudget)} over` : `${formatEUR(cb.remaining)} left`}
								</span>
							</div>

							<div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--ring-track)]">
								<div
									class="h-full rounded-full transition-all"
									style="width: {Math.min(100, cb.percentUsed)}%; background-color: {isOver ? 'var(--accent-red)' : cb.category.color};"
								></div>
							</div>

							<div class="mt-1.5 flex justify-between font-mono text-[11px] text-[var(--text-muted)]">
								<span>Used: {formatEUR(cb.spent)} ({cb.percentUsed.toFixed(0)}%)</span>
								<span>Budget: {formatEUR(cb.category.expected_budget)}</span>
							</div>

							{#if cb.expenses.length > 0}
								<div class="mt-2.5 space-y-1 border-t border-[var(--border-subtle)] pt-2">
									{#each cb.expenses as exp (exp.id)}
										<div class="flex items-center justify-between text-xs">
											<span class="truncate text-[var(--text-main)]">
												{exp.title}
												<span class="font-mono text-[10px] text-[var(--text-muted)]">· {exp.expense_date.slice(5)}</span>
											</span>
											<div class="flex shrink-0 items-center gap-2">
												<span class="font-mono font-semibold text-[var(--accent-red)]">
													-{formatEUR(exp.amount)}
												</span>
												<form method="POST" action="?/deleteDailyExpense" use:enhance>
													<input type="hidden" name="id" value={exp.id} />
													<button
														type="submit"
														aria-label="Delete {exp.title}"
														class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
													>
														✕
													</button>
												</form>
											</div>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				<div class="mt-4 pt-2">
					<button
						type="button"
						onclick={() => (viewMode = 'mobile-wheels')}
						class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] py-2.5 text-xs font-bold text-[var(--text-main)] transition hover:opacity-90"
					>
						🎡 Switch to All Wheels Stacked Below Each Other ↓
					</button>
				</div>
			</section>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- PHONE PWA ERGONOMICS: COMPACT COLLAPSIBLE STAGES 1 & 2 BAR ON MOBILE      -->
	<!-- ========================================================================= -->
	{#if hasAnyRecurringItems && viewMode === 'pipeline'}
		<div
			class="mb-4 flex items-center justify-between rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] px-4 py-3 text-xs md:hidden"
		>
			<div class="flex flex-wrap items-center gap-2 font-mono">
				<span class="text-[var(--accent-green)]">+{formatEUR(totalIncome)}</span>
				<span class="text-[var(--text-muted)]">→</span>
				<span class="text-[var(--accent-red)]">-{formatEUR(totalFixedOutgoing)} fixed</span>
				<span class="text-[var(--text-muted)]">=</span>
				<strong class="text-[var(--text-main)]">{formatEUR(leftAfterFixed)} after fixed</strong>
			</div>
			<button
				type="button"
				onclick={() => (mobileShowFixedStages = !mobileShowFixedStages)}
				class="shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] font-semibold text-[var(--text-main)]"
			>
				{mobileShowFixedStages ? 'Hide Fixed ▴' : 'Show Fixed ▾'}
			</button>
		</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- LEFT-TO-RIGHT PIPELINE OR VERTICAL WHEELS STACK                           -->
	<!-- ========================================================================= -->
	{#if viewMode !== 'mobile-quick'}
	<div class="{viewMode === 'mobile-wheels'
		? 'mx-auto flex max-w-md flex-col gap-4'
		: 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:flex xl:flex-row xl:items-start xl:gap-3'}">
		<!-- STAGE 1: INCOME -->
		<section
			class="{viewMode === 'pipeline' && hasAnyRecurringItems && !mobileShowFixedStages
				? 'hidden md:flex'
				: 'flex'} flex-1 flex-col justify-between rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 shadow-xs {viewMode === 'mobile-wheels' ? 'w-full' : 'xl:w-[23%]'}"
		>
			<div>
				<div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
					<h2 class="text-base font-bold text-[var(--text-main)]">1. Income</h2>
					<button
						type="button"
						onclick={() => (showAddIncome = !showAddIncome)}
						class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
					>
						{showAddIncome ? 'Cancel' : '+ Add'}
					</button>
				</div>

				{#if showAddIncome}
					<form
						method="POST"
						action="?/addIncome"
						use:enhance={() => {
							return async ({ result, update }) => {
								if (result.type === 'success') {
									showAddIncome = false;
									rowIdCounter += 1;
									stageNewIncomes = [{ id: rowIdCounter, name: '', amount: '', color: '#6b846d' }];
								}
								await update();
							};
						}}
						class="mt-3 space-y-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3"
					>
						<input type="hidden" name="month" value={data.month} />
						<div class="space-y-2">
							{#each stageNewIncomes as row (row.id)}
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										bind:value={row.color}
										aria-label="Income color"
										class="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										bind:value={row.name}
										placeholder="Name"
										required
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0.01"
										name="amount"
										bind:value={row.amount}
										placeholder="€"
										required
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									{#if stageNewIncomes.length > 1}
										<button
											type="button"
											onclick={() => (stageNewIncomes = stageNewIncomes.filter((r) => r.id !== row.id))}
											aria-label="Remove row"
											class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							{/each}
						</div>
						<div class="flex flex-wrap gap-1.5 pt-1">
							<button
								type="button"
								onclick={() => {
									rowIdCounter += 1;
									stageNewIncomes.push({
										id: rowIdCounter,
										name: '',
										amount: '',
										color: mutedColors[(activeIncomes.length + stageNewIncomes.length) % mutedColors.length]
									});
								}}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-main)] hover:opacity-85"
							>
								+ Row
							</button>
							<button
								type="submit"
								class="flex-1 rounded-lg bg-[#6b846d] py-1.5 text-xs font-semibold text-white hover:opacity-90"
							>
								✓ Save
							</button>
							<button
								type="button"
								onclick={() => (showAddIncome = false)}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
							>
								Cancel
							</button>
						</div>
					</form>
				{/if}

				<div class="my-5 flex justify-center">
					<PieWheel
						slices={incomeSlices}
						size={170}
						thickness={26}
						centerTitle="Income"
						centerValue={formatEUR(totalIncome)}
					/>
				</div>

				<div class="space-y-1.5">
					{#if activeIncomes.length === 0}
						<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-center text-xs text-[var(--text-faint)]">
							No income sources added
						</p>
					{/if}
					{#each activeIncomes as inc (inc.id)}
						{#if editingIncomeId === inc.id}
							<form
								method="POST"
								action="?/updateIncome"
								use:enhance={() => {
									return async ({ result, update }) => {
										if (result.type === 'success') editingIncomeId = null;
										await update();
									};
								}}
								class="space-y-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 text-xs"
							>
								<input type="hidden" name="id" value={inc.id} />
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										value={inc.color}
										aria-label="Income color"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										value={inc.name}
										required
										class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="amount"
										value={inc.amount}
										required
										class="w-20 shrink-0 rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-main)]"
									/>
								</div>
								<div class="flex justify-end gap-1.5">
									<button
										type="button"
										onclick={() => (editingIncomeId = null)}
										class="rounded border border-[var(--border-main)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
									>
										Cancel
									</button>
									<button
										type="submit"
										class="rounded bg-[#6b846d] px-2.5 py-0.5 text-[11px] font-semibold text-white"
									>
										Save
									</button>
								</div>
							</form>
						{:else}
							<div
								class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] px-3 py-2 text-xs"
							>
								<div class="flex items-center gap-2">
									<span
										class="h-2.5 w-2.5 shrink-0 rounded-full"
										style="background-color: {inc.color}"
									></span>
									<span class="font-medium text-[var(--text-main)]">{inc.name}</span>
								</div>
								<div class="flex items-center gap-2">
									<span class="font-mono font-semibold text-[var(--accent-green)]">
										{formatEUR(inc.amount)}
									</span>
									<button
										type="button"
										aria-label="Edit {inc.name}"
										title="Edit"
										onclick={() => (editingIncomeId = inc.id)}
										class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
									>
										✎
									</button>
									<form method="POST" action="?/deleteIncome" use:enhance>
										<input type="hidden" name="id" value={inc.id} />
										<button
											type="submit"
											aria-label="Delete {inc.name}"
											class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									</form>
								</div>
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<div class="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs">
				<span class="font-medium text-[var(--text-muted)]">Total Income</span>
				<span class="font-mono text-sm font-bold text-[var(--text-main)]">{formatEUR(totalIncome)}</span>
			</div>
		</section>

		<!-- ARROW 1 (Mobile Vertical + Desktop XL Horizontal) -->
		<div
			class="{viewMode === 'mobile-wheels'
				? 'flex items-center justify-center py-0.5'
				: hasAnyRecurringItems && !mobileShowFixedStages
					? 'hidden xl:flex items-center justify-center py-0.5 xl:flex-col xl:py-24'
					: 'flex md:hidden xl:flex items-center justify-center py-0.5 xl:flex-col xl:py-24'}"
		>
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-pill)] px-3 py-1.5 text-center {viewMode === 'mobile-wheels' ? '' : 'xl:flex-col xl:gap-0 xl:px-2.5 xl:py-2'}"
			>
				<span class="font-mono text-xs font-bold text-[var(--text-main)]">{formatEUR(totalIncome)}</span>
				<span class="text-sm leading-none text-[var(--text-muted)] {viewMode === 'mobile-wheels' ? '' : 'xl:hidden'}">↓</span>
				{#if viewMode !== 'mobile-wheels'}
					<span class="hidden text-lg leading-none text-[var(--text-muted)] xl:inline">→</span>
				{/if}
			</div>
		</div>

		<!-- STAGE 2: FIXED SPENDING -->
		<section
			class="{viewMode === 'pipeline' && hasAnyRecurringItems && !mobileShowFixedStages
				? 'hidden md:flex'
				: 'flex'} flex-1 flex-col justify-between rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 shadow-xs {viewMode === 'mobile-wheels' ? 'w-full' : 'xl:w-[23%]'}"
		>
			<div>
				<div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
					<h2 class="text-base font-bold text-[var(--text-main)]">2. Fixed Spending</h2>
					<button
						type="button"
						onclick={() => (showAddFixed = !showAddFixed)}
						class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
					>
						{showAddFixed ? 'Cancel' : '+ Add'}
					</button>
				</div>

				{#if showAddFixed}
					<form
						method="POST"
						action="?/addFixedOutgoing"
						use:enhance={() => {
							return async ({ result, update }) => {
								if (result.type === 'success') {
									showAddFixed = false;
									rowIdCounter += 1;
									stageNewFixed = [{ id: rowIdCounter, name: '', amount: '', color: '#b86b58' }];
								}
								await update();
							};
						}}
						class="mt-3 space-y-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3"
					>
						<input type="hidden" name="month" value={data.month} />
						<input type="hidden" name="group_tag" value="Fixed" />
						<div class="space-y-2">
							{#each stageNewFixed as row (row.id)}
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										bind:value={row.color}
										aria-label="Fixed spending color"
										class="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										bind:value={row.name}
										placeholder="Name (e.g. Rent)"
										required
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0.01"
										name="amount"
										bind:value={row.amount}
										placeholder="€"
										required
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									{#if stageNewFixed.length > 1}
										<button
											type="button"
											onclick={() => (stageNewFixed = stageNewFixed.filter((r) => r.id !== row.id))}
											aria-label="Remove row"
											class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							{/each}
						</div>
						<div class="flex flex-wrap gap-1.5 pt-1">
							<button
								type="button"
								onclick={() => {
									rowIdCounter += 1;
									stageNewFixed.push({
										id: rowIdCounter,
										name: '',
										amount: '',
										color: mutedColors[(activeFixedOutgoings.length + stageNewFixed.length + 1) % mutedColors.length]
									});
								}}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-main)] hover:opacity-85"
							>
								+ Row
							</button>
							<button
								type="submit"
								class="flex-1 rounded-lg bg-[#b86b58] py-1.5 text-xs font-semibold text-white hover:opacity-90"
							>
								✓ Save
							</button>
							<button
								type="button"
								onclick={() => (showAddFixed = false)}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
							>
								Cancel
							</button>
						</div>
					</form>
				{/if}

				<div class="my-5 flex justify-center">
					<PieWheel
						slices={fixedTakingSlices}
						size={170}
						thickness={26}
						centerTitle="Fixed Taken"
						centerValue={formatEUR(totalFixedOutgoing)}
						centerSubtitle={totalIncome > 0
							? `${((totalFixedOutgoing / totalIncome) * 100).toFixed(0)}% of income`
							: ''}
					/>
				</div>

				<div class="space-y-1.5">
					{#if activeFixedOutgoings.length === 0}
						<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-center text-xs text-[var(--text-faint)]">
							No fixed bills added
						</p>
					{/if}
					{#each activeFixedOutgoings as fix (fix.id)}
						{#if editingFixedId === fix.id}
							<form
								method="POST"
								action="?/updateFixedOutgoing"
								use:enhance={() => {
									return async ({ result, update }) => {
										if (result.type === 'success') editingFixedId = null;
										await update();
									};
								}}
								class="space-y-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 text-xs"
							>
								<input type="hidden" name="id" value={fix.id} />
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										value={fix.color}
										aria-label="Fixed spending color"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										value={fix.name}
										required
										class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="amount"
										value={fix.amount}
										required
										class="w-20 shrink-0 rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-main)]"
									/>
								</div>
								<div class="flex justify-end gap-1.5">
									<button
										type="button"
										onclick={() => (editingFixedId = null)}
										class="rounded border border-[var(--border-main)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
									>
										Cancel
									</button>
									<button
										type="submit"
										class="rounded bg-[#b86b58] px-2.5 py-0.5 text-[11px] font-semibold text-white"
									>
										Save
									</button>
								</div>
							</form>
						{:else}
							<div
								class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] px-3 py-2 text-xs"
							>
								<div class="flex min-w-0 items-center gap-2">
									<form method="POST" action="?/toggleFixedSplit" use:enhance class="inline-flex items-center">
										<input type="hidden" name="id" value={fix.id} />
										<input type="hidden" name="split_half" value={fix.split_half ? '0' : '1'} />
										<button
											type="submit"
											role="checkbox"
											aria-checked={Boolean(fix.split_half)}
											aria-label="Mark {fix.name} for roommate 50/50 split"
											title="Mark to sum & halve for roommate rent"
											class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border text-[10px] leading-none font-bold transition {fix.split_half
												? 'border-[var(--accent-ochre)] bg-[var(--accent-ochre)] text-white'
												: 'border-[var(--border-main)] bg-[var(--bg-card)] text-transparent hover:border-[var(--border-strong)]'}"
										>
											✓
										</button>
									</form>
									<span
										class="h-2.5 w-2.5 shrink-0 rounded-full"
										style="background-color: {fix.color}"
									></span>
									<span class="truncate font-medium text-[var(--text-main)]">{fix.name}</span>
									{#if fix.split_half}
										<span
											class="shrink-0 rounded bg-[var(--accent-ochre)]/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--accent-ochre)]"
											title="Included in roommate 50/50 split"
										>
											½
										</span>
									{/if}
								</div>
								<div class="flex shrink-0 items-center gap-2">
									<span class="font-mono font-semibold text-[var(--accent-red)]">
										-{formatEUR(fix.amount)}
									</span>
									<button
										type="button"
										aria-label="Edit {fix.name}"
										title="Edit"
										onclick={() => (editingFixedId = fix.id)}
										class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
									>
										✎
									</button>
									<form method="POST" action="?/deleteFixedOutgoing" use:enhance>
										<input type="hidden" name="id" value={fix.id} />
										<button
											type="submit"
											aria-label="Delete {fix.name}"
											class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									</form>
								</div>
							</div>
						{/if}
					{/each}
				</div>

				{#if activeFixedOutgoings.length > 0}
					<div class="mt-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2.5 text-xs">
						{#if sharedFixedItems.length > 0}
							<div class="flex items-center justify-between text-[var(--text-muted)]">
								<span>Marked Fixed Sum ({sharedFixedItems.length})</span>
								<span class="font-mono font-semibold text-[var(--text-main)]">
									{formatEUR(sharedFixedTotal)}
								</span>
							</div>
							<div class="mt-1 flex items-center justify-between border-t border-[var(--border-subtle)] pt-1 font-bold text-[var(--accent-ochre)]">
								<span>Roommate Rent (÷ 2)</span>
								<span class="font-mono text-sm">{formatEUR(roommateRentShare)}</span>
							</div>
						{:else}
							<div class="text-center text-[11px] text-[var(--text-muted)]">
								Check the small box on items above to sum & halve for roommate rent
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<div class="mt-4 space-y-1 border-t border-[var(--border-subtle)] pt-3 text-xs">
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">Taken by Fixed</span>
					<span class="font-mono font-semibold text-[var(--accent-red)]">-{formatEUR(totalFixedOutgoing)}</span>
				</div>
				<div class="flex justify-between font-bold {leftAfterFixed < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--text-main)]'}">
					<span>Left After Fixed</span>
					<span class="font-mono">{formatEUR(leftAfterFixed)}</span>
				</div>
			</div>
		</section>

		<!-- ARROW 2 (Mobile Vertical + Desktop XL Horizontal) -->
		<div
			class="{viewMode === 'mobile-wheels'
				? 'flex items-center justify-center py-0.5'
				: hasAnyRecurringItems && !mobileShowFixedStages
					? 'hidden xl:flex items-center justify-center py-0.5 xl:flex-col xl:py-24'
					: 'flex md:hidden xl:flex items-center justify-center py-0.5 xl:flex-col xl:py-24'}"
		>
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-pill)] px-3 py-1.5 text-center {viewMode === 'mobile-wheels' ? '' : 'xl:flex-col xl:gap-0 xl:px-2.5 xl:py-2'}"
			>
				<span class="font-mono text-xs font-bold {leftAfterFixed < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--text-main)]'}">
					{formatEUR(leftAfterFixed)}
				</span>
				<span class="text-sm leading-none text-[var(--text-muted)] {viewMode === 'mobile-wheels' ? '' : 'xl:hidden'}">↓</span>
				{#if viewMode !== 'mobile-wheels'}
					<span class="hidden text-lg leading-none text-[var(--text-muted)] xl:inline">→</span>
				{/if}
			</div>
		</div>

		<!-- STAGE 3: SEMI-FIXED OUTGOING -->
		<section
			class="flex flex-1 flex-col justify-between rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 shadow-xs {viewMode === 'mobile-wheels' ? 'w-full' : 'xl:w-[27%]'}"
		>
			<div>
				<div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
					<h2 class="text-base font-bold text-[var(--text-main)]">3. Semi-Fixed Outgoing</h2>
					<button
						type="button"
						onclick={() => (showAddCategory = !showAddCategory)}
						class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
					>
						{showAddCategory ? 'Cancel' : '+ Add Category'}
					</button>
				</div>

				{#if showAddCategory}
					<form
						method="POST"
						action="?/addVariableCategory"
						use:enhance={() => {
							return async ({ result, update }) => {
								if (result.type === 'success') {
									showAddCategory = false;
									rowIdCounter += 1;
									stageNewCats = [{ id: rowIdCounter, name: '', budget: '', color: '#c49a5c' }];
								}
								await update();
							};
						}}
						class="mt-3 space-y-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3"
					>
						<input type="hidden" name="month" value={data.month} />
						<input type="hidden" name="icon" value="folder" />
						<div class="space-y-2">
							{#each stageNewCats as row (row.id)}
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										bind:value={row.color}
										aria-label="Category color"
										class="h-8 w-8 shrink-0 cursor-pointer rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										bind:value={row.name}
										placeholder="Category (e.g. Food)"
										required
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="expected_budget"
										bind:value={row.budget}
										placeholder="Budget €"
										required
										class="w-24 shrink-0 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-xs text-[var(--text-main)] focus-visible:border-[var(--border-strong)] focus-visible:outline-none"
									/>
									{#if stageNewCats.length > 1}
										<button
											type="button"
											onclick={() => (stageNewCats = stageNewCats.filter((r) => r.id !== row.id))}
											aria-label="Remove row"
											class="shrink-0 px-1 text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							{/each}
						</div>
						<div class="flex flex-wrap gap-1.5 pt-1">
							<button
								type="button"
								onclick={() => {
									rowIdCounter += 1;
									stageNewCats.push({
										id: rowIdCounter,
										name: '',
										budget: '',
										color: mutedColors[(data.variableCategories.length + stageNewCats.length + 2) % mutedColors.length]
									});
								}}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-main)] hover:opacity-85"
							>
								+ Row
							</button>
							<button
								type="submit"
								class="flex-1 rounded-lg bg-[var(--btn-primary-bg)] py-1.5 text-xs font-semibold text-[var(--btn-primary-fg)] hover:opacity-90"
							>
								✓ Save
							</button>
							<button
								type="button"
								onclick={() => (showAddCategory = false)}
								class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text-muted)]"
							>
								Cancel
							</button>
						</div>
					</form>
				{/if}

				<div class="my-5 flex justify-center">
					<PieWheel
						slices={semiFixedOverviewSlices}
						size={170}
						thickness={26}
						centerTitle={netSemiFixedBalance < 0 ? 'Net Over Budget' : 'Budget Left'}
						centerValue={formatEUR(netSemiFixedBalance)}
						centerSubtitle="{formatEUR(totalActualVariable)} / {formatEUR(totalExpectedVariable)} used"
					/>
				</div>

				<!-- Summary List of Semi-Fixed Categories in Pipeline -->
				<div class="space-y-2">
					{#if categoryBreakdowns.length === 0}
						<p class="rounded-xl border border-dashed border-[var(--border-subtle)] px-3 py-2 text-center text-xs text-[var(--text-faint)]">
							No semi-fixed categories added
						</p>
					{/if}
					{#each categoryBreakdowns as cb (cb.category.id)}
						{@const isOver = cb.overBudget > 0}
						{#if editingStageCatId === cb.category.id}
							<form
								method="POST"
								action="?/updateVariableCategory"
								use:enhance={() => {
									return async ({ result, update }) => {
										if (result.type === 'success') editingStageCatId = null;
										await update();
									};
								}}
								class="space-y-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 text-xs"
							>
								<input type="hidden" name="id" value={cb.category.id} />
								<div class="flex items-center gap-1.5">
									<input
										type="color"
										name="color"
										value={cb.category.color}
										aria-label="Category color"
										class="h-7 w-7 shrink-0 cursor-pointer rounded border border-[var(--border-main)] bg-[var(--bg-card)] p-0.5"
									/>
									<input
										type="text"
										name="name"
										value={cb.category.name}
										required
										class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
									/>
									<input
										type="number"
										step="0.01"
										min="0"
										name="expected_budget"
										value={cb.category.expected_budget}
										required
										class="w-20 shrink-0 rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-main)]"
									/>
								</div>
								<div class="flex justify-end gap-1.5">
									<button
										type="button"
										onclick={() => (editingStageCatId = null)}
										class="rounded border border-[var(--border-main)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
									>
										Cancel
									</button>
									<button
										type="submit"
										class="rounded bg-[var(--btn-primary-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--btn-primary-fg)]"
									>
										Save
									</button>
								</div>
							</form>
						{:else}
							<div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] p-2.5 text-xs">
								<div class="flex items-center justify-between gap-2">
									<div class="flex min-w-0 items-center gap-2">
										<span
											class="h-2.5 w-2.5 shrink-0 rounded-full"
											style="background-color: {cb.category.color}"
										></span>
										<span class="truncate font-semibold text-[var(--text-main)]">{cb.category.name}</span>
									</div>
									<div class="flex shrink-0 items-center gap-2">
										<span
											class="font-mono font-bold {isOver ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}"
										>
											{isOver
												? `${formatEUR(cb.overBudget)} over`
												: `${formatEUR(cb.remaining)} left`}
										</span>
										<button
											type="button"
											aria-label="Edit {cb.category.name}"
											title="Edit category"
											onclick={() => (editingStageCatId = cb.category.id)}
											class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
										>
											✎
										</button>
										{#if cb.expenses.length === 0}
											<form method="POST" action="?/deleteVariableCategory" use:enhance>
												<input type="hidden" name="id" value={cb.category.id} />
												<button
													type="submit"
													aria-label="Delete {cb.category.name}"
													title="Remove category"
													class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
												>
													✕
												</button>
											</form>
										{:else if confirmingStageDeleteCatId === cb.category.id}
											<form method="POST" action="?/deleteVariableCategory" use:enhance class="inline-flex items-center gap-1">
												<input type="hidden" name="id" value={cb.category.id} />
												<button
													type="submit"
													class="rounded bg-[var(--accent-red)] px-1.5 py-0.5 text-[10px] font-bold text-white"
												>
													Del ({cb.expenses.length})
												</button>
												<button
													type="button"
													onclick={() => (confirmingStageDeleteCatId = null)}
													class="rounded border border-[var(--border-main)] px-1 py-0.5 text-[10px] text-[var(--text-muted)]"
												>
													No
												</button>
											</form>
										{:else}
											<button
												type="button"
												aria-label="Delete {cb.category.name}"
												title="Remove category"
												onclick={() => (confirmingStageDeleteCatId = cb.category.id)}
												class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
											>
												✕
											</button>
										{/if}
									</div>
								</div>

								<div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[var(--ring-track)]">
									<div
										class="h-full rounded-full"
										style="
											width: {Math.min(100, cb.percentUsed)}%;
											background-color: {isOver ? '#b86b58' : cb.category.color};
										"
									></div>
								</div>

								<div class="mt-1 flex justify-between font-mono text-[11px] text-[var(--text-muted)]">
									<span>Used: {formatEUR(cb.spent)} ({cb.percentUsed.toFixed(0)}%)</span>
									<span>Budget: {formatEUR(cb.category.expected_budget)}</span>
								</div>

								{#if cb.expenses.length > 0}
									<div class="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-1.5">
										{#each cb.expenses as exp (exp.id)}
											<div class="flex items-center justify-between gap-2 rounded-lg bg-[var(--bg-subtle)] px-2 py-1 text-[11px]">
												<span class="truncate text-[var(--text-main)]">{exp.title}</span>
												<div class="flex shrink-0 items-center gap-1.5">
													<span class="font-mono font-semibold text-[var(--accent-red)]">
														-{formatEUR(exp.amount)}
													</span>
													<form method="POST" action="?/deleteDailyExpense" use:enhance>
														<input type="hidden" name="id" value={exp.id} />
														<button
															type="submit"
															aria-label="Remove {exp.title}"
															title="Remove expense"
															class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
														>
															✕
														</button>
													</form>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<div class="mt-4 space-y-1 border-t border-[var(--border-subtle)] pt-3 text-xs">
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">Total Semi-Fixed Budget</span>
					<span class="font-mono font-semibold text-[var(--text-main)]">{formatEUR(totalExpectedVariable)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">Used So Far</span>
					<span class="font-mono font-semibold text-[var(--accent-red)]">-{formatEUR(totalActualVariable)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">Budget Still Left</span>
					<span class="font-mono font-semibold text-[var(--accent-green)]">{formatEUR(totalVariableStillLeft)}</span>
				</div>
				{#if totalOverBudget > 0}
					<div class="flex justify-between text-[var(--accent-red)]">
						<span>Over-Budget Excess</span>
						<span class="font-mono font-bold">-{formatEUR(totalOverBudget)}</span>
					</div>
				{/if}
				<div class="flex justify-between border-t border-[var(--border-subtle)] pt-1 font-bold {netSemiFixedBalance < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
					<span>Net Budget Remaining</span>
					<span class="font-mono">{formatEUR(netSemiFixedBalance)}</span>
				</div>
			</div>
		</section>

		<!-- ARROW 3 (Mobile Vertical + Desktop XL Horizontal) -->
		<div class="{viewMode === 'mobile-wheels'
			? 'flex items-center justify-center py-0.5'
			: 'flex items-center justify-center py-0.5 md:hidden xl:flex xl:flex-col xl:py-24'}">
			<div
				class="flex items-center gap-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-pill)] px-3 py-1.5 text-center {viewMode === 'mobile-wheels' ? '' : 'xl:flex-col xl:gap-0 xl:px-2.5 xl:py-2'}"
			>
				<span class="font-mono text-xs font-bold {expectedLeftAtEnd < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
					{formatEUR(expectedLeftAtEnd)}
				</span>
				<span class="text-sm leading-none text-[var(--text-muted)] {viewMode === 'mobile-wheels' ? '' : 'xl:hidden'}">↓</span>
				{#if viewMode !== 'mobile-wheels'}
					<span class="hidden text-lg leading-none text-[var(--text-muted)] xl:inline">→</span>
				{/if}
			</div>
		</div>

		<!-- STAGE 4: WHAT IS LEFT AT THE END -->
		<section
			class="flex flex-1 flex-col justify-between rounded-2xl border-2 border-[var(--border-strong)] bg-[var(--bg-card)] p-5 shadow-xs {viewMode === 'mobile-wheels' ? 'w-full' : 'xl:w-[24%]'}"
		>
			<div>
				<div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
					<h2 class="text-base font-bold text-[var(--text-main)]">4. What Is Left</h2>
					<button
						type="button"
						onclick={() => {
							topCategoryId = '__none__';
							openTopExpenseForm();
							scrollToTop();
						}}
						class="rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
					>
						+ Minus Expense
					</button>
				</div>

				<div class="my-5 flex justify-center">
					<PieWheel
						slices={finalWheelSlices}
						size={185}
						thickness={28}
						centerTitle="What Is Left"
						centerValue={formatEUR(expectedLeftAtEnd)}
						centerSubtitle="{formatEUR(actualLeftNow)} cash now"
						showLegend={true}
					/>
				</div>

				<!-- Direct Minus Expenses (Uncategorized / One-Off) listed directly in What Is Left -->
				{#if uncategorizedExpenses.length > 0}
					<div class="mt-3 space-y-1.5">
						<div class="flex items-center justify-between text-[11px] font-bold tracking-wider text-[var(--accent-red)] uppercase">
							<span>Minus Expenses (No Category)</span>
							<span class="font-mono">-{formatEUR(totalUncategorizedSpent)}</span>
						</div>
						{#each uncategorizedExpenses as exp (exp.id)}
							<div
								class="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] px-3 py-2 text-xs"
							>
								<div class="min-w-0 pr-2">
									<div class="truncate font-medium text-[var(--text-main)]">
										{exp.title}
										{#if exp.note}
											<span class="text-[var(--text-muted)]">· {exp.note}</span>
										{/if}
									</div>
									<div class="font-mono text-[10px] text-[var(--text-muted)]">{exp.expense_date}</div>
								</div>
								<div class="flex shrink-0 items-center gap-2">
									<span class="font-mono font-semibold text-[var(--accent-red)]">
										-{formatEUR(exp.amount)}
									</span>
									<form method="POST" action="?/deleteDailyExpense" use:enhance>
										<input type="hidden" name="id" value={exp.id} />
										<button
											type="submit"
											aria-label="Delete {exp.title}"
											title="Remove expense"
											class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									</form>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="mt-4 space-y-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3.5 text-xs">
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">1. Income</span>
					<span class="font-mono font-semibold text-[var(--accent-green)]">+{formatEUR(totalIncome)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-[var(--text-muted)]">2. Fixed Spending</span>
					<span class="font-mono font-semibold text-[var(--accent-red)]">-{formatEUR(totalFixedOutgoing)}</span>
				</div>
				<div class="flex justify-between {totalOverBudget > 0 || totalUncategorizedSpent > 0 ? '' : 'border-b border-[var(--border-main)] pb-1.5'}">
					<span class="text-[var(--text-muted)]">3. Semi-Fixed Budgets</span>
					<span class="font-mono font-semibold text-[var(--accent-ochre)]">-{formatEUR(totalExpectedVariable)}</span>
				</div>
				{#if totalOverBudget > 0}
					<div class="flex justify-between {totalUncategorizedSpent > 0 ? '' : 'border-b border-[var(--border-main)] pb-1.5'} text-[var(--accent-red)]">
						<span>Semi-Fixed Over-Budget</span>
						<span class="font-mono font-bold">-{formatEUR(totalOverBudget)}</span>
					</div>
				{/if}
				{#if totalUncategorizedSpent > 0}
					<div class="flex justify-between border-b border-[var(--border-main)] pb-1.5 text-[var(--accent-red)]">
						<span>Minus Expenses (No Category)</span>
						<span class="font-mono font-bold">-{formatEUR(totalUncategorizedSpent)}</span>
					</div>
				{/if}

				<div class="flex justify-between pt-1 text-sm font-bold text-[var(--text-main)]">
					<span>What Is Left</span>
					<span class="font-mono {expectedLeftAtEnd < 0 ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
						{formatEUR(expectedLeftAtEnd)}
					</span>
				</div>

				<div class="flex justify-between border-t border-[var(--border-main)] pt-2 text-xs">
					<span class="text-[var(--text-muted)]">Actual Cash Left Now</span>
					<span class="font-mono font-bold text-[var(--text-main)]">{formatEUR(actualLeftNow)}</span>
				</div>
			</div>
		</section>
	</div>
	{/if}

	<!-- ========================================================================= -->
	<!-- SEMI-FIXED BUDGET PIES: USED VS. STILL LEFT + EXPANDABLE EXPENSE LIST     -->
	<!-- ========================================================================= -->
	{#if categoryBreakdowns.length > 0 && viewMode !== 'mobile-quick'}
		<section class="mt-10 border-t border-[var(--border-main)] pt-8 {viewMode === 'mobile-wheels' ? 'mx-auto max-w-md' : ''}">
			<div class="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h2 class="text-lg font-bold text-[var(--text-main)]">
					Semi-Fixed Categories: Used vs. Still Left
				</h2>
			</div>

			<div class="{viewMode === 'mobile-wheels'
				? 'grid grid-cols-1 gap-4'
				: 'grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}">
				{#each categoryBreakdowns as cb (cb.category.id)}
					{@const isOver = cb.overBudget > 0}
					{@const isExpanded = !collapsedCategoryIds[cb.category.id]}
					<div
						class="flex flex-col justify-between rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-5 shadow-xs"
					>
						<div>
							<div class="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
								<div class="flex items-center gap-2">
									<span
										class="h-3 w-3 shrink-0 rounded-full"
										style="background-color: {cb.category.color}"
									></span>
									<h3 class="text-sm font-bold text-[var(--text-main)]">{cb.category.name}</h3>
								</div>
								<div class="flex items-center gap-2">
									<button
										type="button"
										onclick={() => {
											if (editingCategoryId === cb.category.id) {
												editingCategoryId = null;
											} else {
												editingCategoryId = cb.category.id;
												editingBudgetValue = cb.category.expected_budget;
											}
										}}
										class="text-[11px] text-[var(--text-muted)] underline hover:text-[var(--text-main)]"
									>
										{editingCategoryId === cb.category.id ? 'cancel' : 'edit budget'}
									</button>

									{#if cb.expenses.length === 0}
										<form method="POST" action="?/deleteVariableCategory" use:enhance>
											<input type="hidden" name="id" value={cb.category.id} />
											<button
												type="submit"
												aria-label="Delete category {cb.category.name}"
												title="Remove category"
												class="text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
											>
												✕
											</button>
										</form>
									{:else if confirmingDeleteCatId === cb.category.id}
										<form method="POST" action="?/deleteVariableCategory" use:enhance class="inline-flex items-center gap-1">
											<input type="hidden" name="id" value={cb.category.id} />
											<button
												type="submit"
												class="rounded bg-[var(--accent-red)] px-1.5 py-0.5 text-[10px] font-bold text-white"
											>
												Delete ({cb.expenses.length})
											</button>
											<button
												type="button"
												onclick={() => (confirmingDeleteCatId = null)}
												class="rounded border border-[var(--border-main)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
											>
												No
											</button>
										</form>
									{:else}
										<button
											type="button"
											aria-label="Delete category {cb.category.name}"
											onclick={() => (confirmingDeleteCatId = cb.category.id)}
											class="text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
										>
											✕
										</button>
									{/if}
								</div>
							</div>

							{#if editingCategoryId === cb.category.id}
								<form
									method="POST"
									action="?/updateVariableCategory"
									use:enhance={() => {
										return async ({ result, update }) => {
											if (result.type === 'success') editingCategoryId = null;
											await update();
										};
									}}
									class="mt-3 flex gap-1.5"
								>
									<input type="hidden" name="id" value={cb.category.id} />
									<input
										type="number"
										step="0.01"
										min="0"
										name="expected_budget"
										bind:value={editingBudgetValue}
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] px-2.5 py-1 font-mono text-xs text-[var(--text-main)]"
									/>
									<button
										type="submit"
										class="rounded-lg bg-[var(--btn-primary-bg)] px-3 py-1 text-xs font-semibold text-[var(--btn-primary-fg)]"
									>
										Save
									</button>
									<button
										type="button"
										onclick={() => (editingCategoryId = null)}
										class="rounded-lg border border-[var(--border-main)] px-2 py-1 text-xs text-[var(--text-muted)]"
									>
										Cancel
									</button>
								</form>
							{/if}

							<!-- Pie Diagram for this Semi-Fixed Item (Used vs Still Left) -->
							<div class="my-4 flex justify-center">
								<PieWheel
									slices={cb.pieSlices}
									size={155}
									thickness={24}
									centerTitle={isOver ? 'Over Budget' : 'Still Left'}
									centerValue={isOver
										? `-${formatEUR(cb.overBudget)}`
										: formatEUR(cb.remaining)}
									centerSubtitle="{cb.percentUsed.toFixed(0)}% used"
								/>
							</div>

							<!-- Budget / Used / Still Left Breakdown -->
							<div class="space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3 text-xs">
								<div class="flex justify-between">
									<span class="text-[var(--text-muted)]">Monthly Budget</span>
									<span class="font-mono font-semibold text-[var(--text-main)]">
										{formatEUR(cb.category.expected_budget)}
									</span>
								</div>
								<div class="flex justify-between">
									<span class="text-[var(--text-muted)]">Already Used</span>
									<span class="font-mono font-semibold text-[var(--accent-red)]">
										-{formatEUR(cb.spent)}
									</span>
								</div>
								<div class="flex justify-between border-t border-[var(--border-main)] pt-1.5 font-bold">
									<span class="text-[var(--text-main)]">Still Left</span>
									<span class="font-mono {isOver ? 'text-[var(--accent-red)]' : 'text-[var(--accent-green)]'}">
										{isOver ? `-${formatEUR(cb.overBudget)}` : formatEUR(cb.remaining)}
									</span>
								</div>
							</div>

							<!-- Expandable Expense List Inside This Semi-Fixed Card -->
							{#if cb.expenses.length > 0}
								<div class="mt-3">
									<button
										type="button"
										onclick={() => toggleCategoryExpenses(cb.category.id)}
										class="flex w-full items-center justify-between rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-main)]"
									>
										<span>Expenses ({cb.expenses.length})</span>
										<span>{isExpanded ? '▴' : '▾'}</span>
									</button>

									{#if isExpanded}
										<div class="mt-1.5 max-h-56 space-y-1.5 overflow-y-auto pr-0.5">
											{#each cb.expenses as exp (exp.id)}
												{#if editingExpenseId === exp.id}
													<form
														method="POST"
														action="?/updateDailyExpense"
														use:enhance={() => {
															return async ({ result, update }) => {
																if (result.type === 'success') editingExpenseId = null;
																await update();
															};
														}}
														class="space-y-1.5 rounded-lg border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2 text-xs"
													>
														<input type="hidden" name="id" value={exp.id} />
														<select
															name="category_id"
															value={exp.category_id || '__none__'}
															aria-label="Category"
															class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
														>
															{#each data.variableCategories as catOpt (catOpt.id)}
																<option value={catOpt.id}>{catOpt.name}</option>
															{/each}
															<option value="__none__">No Category — What Is Left (Minus Expense)</option>
														</select>
														<input
															type="text"
															name="title"
															value={exp.title}
															required
															class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
														/>
														<div class="flex gap-1.5">
															<input
																type="number"
																step="0.01"
																min="0.01"
																name="amount"
																value={exp.amount}
																required
																class="w-24 rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 font-mono text-xs text-[var(--text-main)]"
															/>
															<input
																type="date"
																name="expense_date"
																value={exp.expense_date}
																required
																class="flex-1 rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 font-mono text-[11px] text-[var(--text-main)]"
															/>
														</div>
														<input
															type="text"
															name="note"
															value={exp.note}
															placeholder="Note (optional)"
															class="w-full rounded border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1 text-xs text-[var(--text-main)]"
														/>
														<div class="flex justify-end gap-1.5">
															<button
																type="button"
																onclick={() => (editingExpenseId = null)}
																class="rounded border border-[var(--border-main)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]"
															>
																Cancel
															</button>
															<button
																type="submit"
																class="rounded bg-[var(--btn-primary-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--btn-primary-fg)]"
															>
																Save
															</button>
														</div>
													</form>
												{:else}
													<div
														class="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-item)] px-2.5 py-1.5 text-xs"
													>
														<div class="min-w-0 pr-2">
															<div class="truncate font-medium text-[var(--text-main)]">
																{exp.title}
																{#if exp.note}
																	<span class="text-[var(--text-muted)]">· {exp.note}</span>
																{/if}
															</div>
															<div class="font-mono text-[10px] text-[var(--text-muted)]">
																{exp.expense_date}
															</div>
														</div>
														<div class="flex shrink-0 items-center gap-2">
															<span class="font-mono font-semibold text-[var(--accent-red)]">
																-{formatEUR(exp.amount)}
															</span>
															<button
																type="button"
																aria-label="Edit {exp.title}"
																onclick={() => (editingExpenseId = exp.id)}
																class="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-main)]"
																title="Edit"
															>
																✎
															</button>
															<form method="POST" action="?/deleteDailyExpense" use:enhance>
																<input type="hidden" name="id" value={exp.id} />
																<button
																	type="submit"
																	aria-label="Delete {exp.title}"
																	class="text-[var(--text-faint)] hover:text-[var(--accent-red)]"
																	title="Delete"
																>
																	✕
																</button>
															</form>
														</div>
													</div>
												{/if}
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>

						<!-- Quick Inline Expense Entry for this specific Semi-Fixed bucket -->
						<div class="mt-3 pt-2">
							{#if loggingForCategoryId === cb.category.id}
								<form
									method="POST"
									action="?/addDailyExpense"
									use:enhance={() => {
										return async ({ result, update }) => {
											if (result.type === 'success') loggingForCategoryId = null;
											await update();
										};
									}}
									class="space-y-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-2.5"
								>
									<input type="hidden" name="month" value={data.month} />
									<input type="hidden" name="category_id" value={cb.category.id} />
									<input
										type="text"
										name="title"
										placeholder="Expense name"
										required
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
									/>
									<div class="flex gap-1.5">
										<input
											type="number"
											step="0.01"
											min="0.01"
											name="amount"
											placeholder="Amount (€)"
											required
											class="w-24 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-main)]"
										/>
										<input
											type="date"
											name="expense_date"
											bind:value={inlineExpenseDate}
											required
											class="flex-1 rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-main)]"
										/>
									</div>
									<input
										type="text"
										name="note"
										placeholder="Optional note"
										class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
									/>
									<div class="flex justify-end gap-1.5">
										<button
											type="button"
											onclick={() => (loggingForCategoryId = null)}
											class="rounded-lg border border-[var(--border-main)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
										>
											Cancel
										</button>
										<button
											type="submit"
											class="rounded-lg bg-[var(--btn-primary-bg)] px-3 py-1 text-xs font-semibold text-[var(--btn-primary-fg)]"
										>
											Add
										</button>
									</div>
								</form>
							{:else}
								<button
									type="button"
									onclick={() => {
										inlineExpenseDate = getDefaultDateForMonth(data.month);
										loggingForCategoryId = cb.category.id;
									}}
									class="w-full rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] py-2 text-xs font-semibold text-[var(--text-main)] transition hover:opacity-85"
								>
									+ Log {cb.category.name} Expense
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- ========================================================================= -->
	<!-- ALL MANUALLY TYPED EXPENSES THIS MONTH (Below Semi-Fixed Categories)      -->
	<!-- ========================================================================= -->
	<section class="mt-10 border-t border-[var(--border-main)] pt-8">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold text-[var(--text-main)]">
					All Expenses Typed In This Month ({data.dailyExpenses.length})
				</h2>
				<p class="text-xs text-[var(--text-muted)]">
					Every manual expense entered in {formatMonthLabel(data.month)} — both Semi-Fixed category expenses and direct What Is Left minus expenses.
				</p>
			</div>
			<div class="flex items-center gap-3">
				<span class="rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-1.5 font-mono text-xs font-bold text-[var(--accent-red)]">
					Total Manual Expenses: -{formatEUR(totalAllManualExpenses)}
				</span>
				<button
					type="button"
					onclick={() => {
						if (viewMode === 'mobile-quick') {
							scrollToTop();
							topTitleInput?.focus();
						} else {
							openTopExpenseForm();
							scrollToTop();
						}
					}}
					class="rounded-xl bg-[var(--btn-primary-bg)] px-3.5 py-2 text-xs font-bold text-[var(--btn-primary-fg)] transition hover:opacity-90"
				>
					+ Put In Expense
				</button>
			</div>
		</div>

		{#if data.dailyExpenses.length === 0}
			<div class="rounded-2xl border border-dashed border-[var(--border-main)] bg-[var(--bg-card)] p-6 text-center text-xs text-[var(--text-faint)]">
				No manual expenses typed in for {formatMonthLabel(data.month)} yet.
			</div>
		{:else}
			<div class="space-y-2 rounded-2xl border border-[var(--border-main)] bg-[var(--bg-card)] p-4 shadow-xs">
				{#each data.dailyExpenses as exp (exp.id)}
					{@const cat = data.variableCategories.find((c) => c.id === exp.category_id)}
					{#if editingExpenseId === `bottom-${exp.id}`}
						<form
							method="POST"
							action="?/updateDailyExpense"
							use:enhance={() => {
								return async ({ result, update }) => {
									if (result.type === 'success') editingExpenseId = null;
									await update();
								};
							}}
							class="grid grid-cols-1 gap-2 rounded-xl border border-[var(--border-main)] bg-[var(--bg-subtle)] p-3 text-xs sm:grid-cols-12 sm:items-center"
						>
							<input type="hidden" name="id" value={exp.id} />
							<div class="sm:col-span-3">
								<input
									type="text"
									name="title"
									value={exp.title}
									required
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
								/>
							</div>
							<div class="sm:col-span-3">
								<select
									name="category_id"
									value={exp.category_id || '__none__'}
									aria-label="Category"
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 text-xs text-[var(--text-main)]"
								>
									{#each data.variableCategories as catOpt (catOpt.id)}
										<option value={catOpt.id}>{catOpt.name}</option>
									{/each}
									<option value="__none__">No Category — What Is Left</option>
								</select>
							</div>
							<div class="sm:col-span-2">
								<input
									type="number"
									step="0.01"
									min="0.01"
									name="amount"
									value={exp.amount}
									required
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2.5 py-1.5 font-mono text-xs text-[var(--text-main)]"
								/>
							</div>
							<div class="sm:col-span-2">
								<input
									type="date"
									name="expense_date"
									value={exp.expense_date}
									required
									class="w-full rounded-lg border border-[var(--border-main)] bg-[var(--bg-card)] px-2 py-1.5 font-mono text-[11px] text-[var(--text-main)]"
								/>
							</div>
							<div class="flex items-center justify-end gap-1.5 sm:col-span-2">
								<button
									type="button"
									onclick={() => (editingExpenseId = null)}
									class="rounded-lg border border-[var(--border-main)] px-2.5 py-1 text-xs text-[var(--text-muted)]"
								>
									Cancel
								</button>
								<button
									type="submit"
									class="rounded-lg bg-[var(--btn-primary-bg)] px-3 py-1 text-xs font-semibold text-[var(--btn-primary-fg)]"
								>
									Save
								</button>
							</div>
						</form>
					{:else}
						<div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-item)] px-3.5 py-2.5 text-xs">
							<div class="flex min-w-0 flex-wrap items-center gap-2.5">
								<span class="font-mono text-[11px] text-[var(--text-muted)]">{exp.expense_date}</span>
								<span class="font-semibold text-[var(--text-main)]">{exp.title}</span>
								{#if exp.note}
									<span class="text-[var(--text-muted)]">· {exp.note}</span>
								{/if}
								{#if cat}
									<span
										class="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-main)]"
									>
										<span
											class="h-2 w-2 rounded-full"
											style="background-color: {cat.color}"
										></span>
										{cat.name}
									</span>
								{:else}
									<span
										class="inline-flex items-center gap-1 rounded-full bg-[var(--accent-red)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--accent-red)]"
									>
										What Is Left (No Category)
									</span>
								{/if}
							</div>

							<div class="flex shrink-0 items-center gap-3">
								<span class="font-mono text-sm font-bold text-[var(--accent-red)]">
									-{formatEUR(exp.amount)}
								</span>
								<button
									type="button"
									aria-label="Edit {exp.title}"
									title="Edit expense"
									onclick={() => (editingExpenseId = `bottom-${exp.id}`)}
									class="text-xs text-[var(--text-muted)] hover:text-[var(--text-main)]"
								>
									✎
								</button>
								<form method="POST" action="?/deleteDailyExpense" use:enhance>
									<input type="hidden" name="id" value={exp.id} />
									<button
										type="submit"
										aria-label="Remove {exp.title}"
										title="Remove expense"
										class="text-xs text-[var(--text-faint)] hover:text-[var(--accent-red)]"
									>
										✕
									</button>
								</form>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		{/if}
	</section>

	<!-- STICKY MOBILE BOTTOM ACTION BUTTON FOR PHONE PWA (Hidden when form is open, respects iOS safe-area) -->
	{#if !showTopExpenseForm && viewMode !== 'mobile-quick'}
		<div
			class="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-main)] bg-[var(--bg-card)]/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden"
		>
			<button
				type="button"
				onclick={() => {
					viewMode = 'mobile-quick';
					scrollToTop();
				}}
				class="w-full rounded-xl bg-[var(--btn-primary-bg)] py-3 text-xs font-bold text-[var(--btn-primary-fg)] shadow-md"
			>
				⚡ + Put In Expense & See What Is Left
			</button>
		</div>
	{/if}
</div></div>
