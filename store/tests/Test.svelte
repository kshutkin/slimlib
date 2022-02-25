<script>
	import { items } from './store';
</script>

{#each $items as item}
    <li>{item}</li>
{/each}