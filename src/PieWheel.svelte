<script lang="ts">
	import type { PieSlice } from './types';

	interface Props {
		slices: PieSlice[];
		size?: number;
		thickness?: number;
		centerTitle?: string;
		centerValue?: string;
		centerSubtitle?: string;
		interactive?: boolean;
		showLegend?: boolean;
		emptyLabel?: string;
	}

	let {
		slices = [],
		size = 200,
		thickness = 30,
		centerTitle = 'Total',
		centerValue = '€0',
		centerSubtitle = '',
		interactive = true,
		showLegend = false,
		emptyLabel = 'Empty'
	}: Props = $props();

	let activeId = $state<string | null>(null);

	const positiveSlices = $derived(slices.filter((s) => s.value > 0));
	const totalValue = $derived(positiveSlices.reduce((sum, s) => sum + s.value, 0));

	const activeSlice = $derived(
		activeId ? positiveSlices.find((s) => s.id === activeId) ?? null : null
	);

	function formatCurrency(val: number): string {
		return new Intl.NumberFormat('de-DE', {
			style: 'currency',
			currency: 'EUR',
			maximumFractionDigits: val % 1 === 0 ? 0 : 2
		}).format(val);
	}

	const radius = $derived((size - thickness - 16) / 2);
	const outerBorderRadius = $derived(radius + thickness / 2 + 3.5);
	const center = $derived(size / 2);
	const circumference = $derived(2 * Math.PI * radius);
	const outerCircumference = $derived(2 * Math.PI * outerBorderRadius);
	const innerDiameter = $derived(Math.max(64, size - thickness * 2 - 12));
	const isCompact = $derived(innerDiameter < 96);

	const computedArcs = $derived.by(() => {
		if (totalValue <= 0) return [];
		let accumulated = 0;
		const maxGap = positiveSlices.length > 1 ? Math.min(2.5, circumference * 0.006) : 0;

		return positiveSlices.map((slice) => {
			const fraction = slice.value / totalValue;
			const rawLength = fraction * circumference;
			const effectiveGap = rawLength > maxGap * 2 ? maxGap : rawLength * 0.2;
			const arcLength = Math.max(0.5, rawLength - effectiveGap);
			const dashOffset = circumference - accumulated * circumference;

			const outerRawLength = fraction * outerCircumference;
			const outerGap = effectiveGap * (outerBorderRadius / radius);
			const outerFullSliceLength = Math.max(0.5, outerRawLength - outerGap);
			const outerDashOffset = outerCircumference - accumulated * outerCircumference;
			const hasSpentIndicator = slice.spentAmount !== undefined;
			const spentRatio =
				hasSpentIndicator && slice.value > 0
					? Math.min(1, Math.max(0, (slice.spentAmount ?? 0) / slice.value))
					: 0;
			const outerSpentLength = outerFullSliceLength * spentRatio;

			accumulated += fraction;

			return {
				...slice,
				percentage: fraction * 100,
				arcLength,
				dashArray: `${arcLength} ${Math.max(0, circumference - arcLength)}`,
				dashOffset,
				hasSpentIndicator,
				spentRatio,
				outerFullDashArray: `${outerFullSliceLength} ${Math.max(0, outerCircumference - outerFullSliceLength)}`,
				outerSpentDashArray: `${outerSpentLength} ${Math.max(0, outerCircumference - outerSpentLength)}`,
				outerDashOffset
			};
		});
	});

	function toggleSlice(id: string) {
		if (!interactive) return;
		activeId = activeId === id ? null : id;
	}
</script>

<div class="flex flex-col items-center gap-3">
	<div class="relative flex items-center justify-center" style="width: {size}px; height: {size}px;">
		<svg
			width={size}
			height={size}
			viewBox="0 0 {size} {size}"
			role="img"
			aria-label="{centerTitle}: {centerValue}"
			class="overflow-visible -rotate-90 transform select-none"
		>
			<circle
				cx={center}
				cy={center}
				r={radius}
				fill="transparent"
				stroke="var(--ring-track)"
				stroke-width={thickness}
			/>

			{#if computedArcs.length > 0}
				{#each computedArcs as arc (arc.id)}
					{@const isHovered = activeId === arc.id}
					{@const isDimmed = activeId !== null && !isHovered}
					<circle
						cx={center}
						cy={center}
						r={radius}
						fill="transparent"
						stroke={arc.color}
						stroke-width={isHovered ? thickness + 4 : thickness}
						stroke-dasharray={arc.dashArray}
						stroke-dashoffset={arc.dashOffset}
						role="button"
						tabindex={interactive ? 0 : -1}
						aria-label="{arc.label}: {formatCurrency(arc.value)} ({arc.percentage.toFixed(0)}%)"
						class="transition-all duration-150 ease-out focus:outline-none {interactive
							? 'cursor-pointer'
							: ''}"
						style="opacity: {isDimmed ? 0.42 : 1};"
						onmouseenter={() => {
							if (interactive) activeId = arc.id;
						}}
						onmouseleave={() => {
							if (interactive) activeId = null;
						}}
						onfocus={() => {
							if (interactive) activeId = arc.id;
						}}
						onblur={() => {
							if (interactive) activeId = null;
						}}
						onclick={() => toggleSlice(arc.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								toggleSlice(arc.id);
							}
						}}
					/>

					{#if arc.hasSpentIndicator}
						<circle
							cx={center}
							cy={center}
							r={outerBorderRadius}
							fill="transparent"
							stroke="var(--ring-track)"
							stroke-width="4"
							stroke-dasharray={arc.outerFullDashArray}
							stroke-dashoffset={arc.outerDashOffset}
							class="pointer-events-none transition-opacity duration-150"
							style="opacity: {isDimmed ? 0.25 : 0.65};"
						/>
						{#if arc.spentRatio > 0}
							<circle
								cx={center}
								cy={center}
								r={outerBorderRadius}
								fill="transparent"
								stroke="#e03e36"
								stroke-width={isHovered ? 5.5 : 4.5}
								stroke-dasharray={arc.outerSpentDashArray}
								stroke-dashoffset={arc.outerDashOffset}
								class="pointer-events-none transition-all duration-150 ease-out"
								style="opacity: {isDimmed ? 0.45 : 1};"
							/>
						{/if}
					{/if}
				{/each}
			{/if}
		</svg>

		<div
			class="pointer-events-none absolute flex flex-col items-center justify-center text-center leading-tight"
			style="width: {innerDiameter}px; max-width: {innerDiameter}px;"
		>
			{#if activeSlice}
				<span
					class="w-full truncate font-semibold tracking-wider text-[var(--text-muted)] uppercase {isCompact
						? 'text-[9px]'
						: 'text-[10px]'}"
				>
					{activeSlice.label}
				</span>
				<span
					class="mt-0.5 w-full truncate font-mono font-bold tracking-tight text-[var(--text-main)] {isCompact
						? 'text-xs'
						: 'text-base'}"
				>
					{formatCurrency(activeSlice.value)}
				</span>
				<span class="w-full truncate text-[var(--text-muted)] {isCompact ? 'text-[9px]' : 'text-[10px]'}">
					{#if activeSlice.spentAmount !== undefined}
						Used {formatCurrency(activeSlice.spentAmount)} ({activeSlice.value > 0
							? ((activeSlice.spentAmount / activeSlice.value) * 100).toFixed(0)
							: '0'}%)
					{:else}
						{totalValue > 0 ? ((activeSlice.value / totalValue) * 100).toFixed(0) : '0'}%
						{#if activeSlice.sublabel && !isCompact}
							· {activeSlice.sublabel}
						{/if}
					{/if}
				</span>
			{:else if totalValue > 0}
				<span
					class="w-full truncate font-semibold tracking-widest text-[var(--text-muted)] uppercase {isCompact
						? 'text-[9px]'
						: 'text-[10px]'}"
				>
					{centerTitle}
				</span>
				<span
					class="mt-0.5 w-full truncate font-mono font-bold tracking-tight text-[var(--text-main)] {isCompact
						? 'text-xs'
						: centerValue.length >= 9
							? 'text-sm'
							: 'text-base'}"
				>
					{centerValue}
				</span>
				{#if centerSubtitle}
					<span
						class="mt-0.5 w-full truncate text-[var(--text-muted)] {isCompact
							? 'text-[9px]'
							: 'text-[10px]'}"
					>
						{centerSubtitle}
					</span>
				{/if}
			{:else}
				<span class="text-xs font-medium text-[var(--text-faint)]">{emptyLabel}</span>
			{/if}
		</div>
	</div>

	{#if showLegend && computedArcs.length > 0}
		<div class="w-full space-y-1">
			{#each computedArcs as arc (arc.id)}
				<button
					type="button"
					class="flex w-full items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-item)] px-2.5 py-1.5 text-left text-xs transition hover:border-[var(--border-strong)] focus-visible:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none {activeId ===
					arc.id
						? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]'
						: ''}"
					onmouseenter={() => (activeId = arc.id)}
					onmouseleave={() => (activeId = null)}
					onfocus={() => (activeId = arc.id)}
					onblur={() => (activeId = null)}
					onclick={() => toggleSlice(arc.id)}
				>
					<div class="flex min-w-0 items-center gap-2">
						<span
							class="h-2.5 w-2.5 shrink-0 rounded-full"
							style="background-color: {arc.color};"
						></span>
						<span class="truncate font-medium text-[var(--text-main)]">{arc.label}</span>
					</div>
					<div class="flex shrink-0 items-center gap-2 font-mono">
						<span class="font-semibold text-[var(--text-main)]">{formatCurrency(arc.value)}</span>
						<span class="w-9 text-right text-[11px] text-[var(--text-muted)]">
							{arc.percentage.toFixed(0)}%
						</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
