<script lang="ts">
	import { auth } from '$lib/auth.svelte';

	let username = $state('');
	let password = $state('');
	let error = $state('');
	let submitting = $state(false);

	async function submit(event: Event) {
		event.preventDefault();
		submitting = true;
		error = '';
		const endpoint = auth.needsBootstrap ? '/api/auth/bootstrap' : '/api/auth/login';
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username, password })
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok) {
				error = body.message || 'Sign-in failed';
				return;
			}
			auth.user = body.user;
			auth.needsBootstrap = false;
			window.location.assign('/');
		} catch {
			error = 'Could not reach the server';
		} finally {
			submitting = false;
		}
	}
</script>

<svelte:head>
	<title>{auth.needsBootstrap ? 'Create admin' : 'Sign in'}</title>
</svelte:head>

<div class="min-h-[70vh] flex items-center justify-center">
	<form class="card bg-base-100 shadow-xl w-full max-w-md" onsubmit={submit}>
		<div class="card-body gap-4">
			<div>
				<p class="section-label mb-2">Accounting</p>
				<h1 class="text-2xl font-bold">
					{auth.needsBootstrap ? 'Create the administrator' : 'Sign in'}
				</h1>
				<p class="text-sm text-base-content/70 mt-2">
					{auth.needsBootstrap
						? 'This database has no users yet. The first account is an administrator and keeps the existing books.'
						: 'Use your username and password. An assistant uses an API token instead of this form.'}
				</p>
			</div>
			{#if error}
				<div class="alert alert-error text-sm"><span>{error}</span></div>
			{/if}
			<label class="form-control">
				<span class="label-text">Username</span>
				<input class="input input-bordered" bind:value={username} autocomplete="username" required />
			</label>
			<label class="form-control">
				<span class="label-text">Password</span>
				<input
					class="input input-bordered"
					type="password"
					bind:value={password}
					autocomplete={auth.needsBootstrap ? 'new-password' : 'current-password'}
					minlength="8"
					required
				/>
			</label>
			<button class="btn btn-primary" type="submit" disabled={submitting}>
				{submitting ? 'Please wait…' : auth.needsBootstrap ? 'Create admin and continue' : 'Sign in'}
			</button>
		</div>
	</form>
</div>
