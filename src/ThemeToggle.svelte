<script lang="ts">
	import { onMount } from 'svelte';

	let isDark = $state(false);
	let rootEl = $state<HTMLElement | null>(null);

	onMount(() => {
		const container = rootEl?.closest('.efp-root');
		isDark = document.body.classList.contains('theme-dark');
		if (container) {
			container.classList.toggle('dark', isDark);
			container.classList.toggle('light', !isDark);
		}

		const observer = new MutationObserver(() => {
			const bodyDark = document.body.classList.contains('theme-dark');
			isDark = bodyDark;
			const c = rootEl?.closest('.efp-root');
			if (c) {
				c.classList.toggle('dark', isDark);
				c.classList.toggle('light', !isDark);
			}
		});
		observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
		return () => observer.disconnect();
	});

	function toggleTheme() {
		isDark = !isDark;
		const container = rootEl?.closest('.efp-root');
		if (container) {
			container.classList.toggle('dark', isDark);
			container.classList.toggle('light', !isDark);
		}
	}
</script>

<button
	bind:this={rootEl}
	type="button"
	onclick={toggleTheme}
	aria-label="Toggle dark mode"
	class="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-card)] px-3 py-2 text-xs font-semibold text-[var(--text-main)] transition hover:bg-[var(--bg-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] focus-visible:outline-none"
>
	<span>{isDark ? '☀ Light' : '☾ Dark'}</span>
</button>
