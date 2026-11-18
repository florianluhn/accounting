<script lang="ts">
	type Rights = 'add' | 'add_edit' | 'add_edit_delete';
	interface UserRow {
		id: number;
		username: string;
		isAdmin: boolean;
		rights: Rights;
		isActive: boolean;
	}
	interface TokenRow {
		id: number;
		name: string;
		tokenPrefix: string;
		createdAt: string;
		lastUsedAt: string | null;
		revokedAt: string | null;
	}

	let users = $state<UserRow[]>([]);
	let error = $state('');
	let notice = $state('');
	let revealedToken = $state('');
	let copyState = $state<'idle' | 'copied' | 'manual'>('idle');
	let tokenField = $state<HTMLInputElement | null>(null);
	let username = $state('');
	let password = $state('');
	let isAdmin = $state(false);
	let rights = $state<Rights>('add_edit_delete');
	let tokenUserId = $state<number | null>(null);
	let tokens = $state<TokenRow[]>([]);
	let tokenName = $state('');

	const rightsLabel: Record<Rights, string> = {
		add: 'Add only',
		add_edit: 'Add + edit',
		add_edit_delete: 'Add + edit + delete'
	};

	async function load() {
		const response = await fetch('/api/users', { credentials: 'same-origin' });
		if (!response.ok) {
			error = 'Could not load users';
			return;
		}
		users = await response.json();
	}

	async function createUser(event: Event) {
		event.preventDefault();
		error = '';
		notice = '';
		const response = await fetch('/api/users', {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password, isAdmin, rights })
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			error = body.message || 'Could not create user';
			return;
		}
		username = '';
		password = '';
		isAdmin = false;
		notice = `Created ${body.username}`;
		await load();
	}

	async function saveUser(user: UserRow) {
		error = '';
		notice = '';
		const response = await fetch(`/api/users/${user.id}`, {
			method: 'PUT',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				isAdmin: user.isAdmin,
				rights: user.rights,
				isActive: user.isActive
			})
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			error = body.message || 'Could not update user';
			await load();
			return;
		}
		notice = `Updated ${user.username}`;
	}

	async function resetPassword(user: UserRow) {
		const next = window.prompt(`New password for ${user.username} (at least 8 characters)`);
		if (!next) return;
		const response = await fetch(`/api/users/${user.id}`, {
			method: 'PUT',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ password: next })
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) error = body.message || 'Could not reset password';
		else notice = `Password updated for ${user.username}`;
	}

	async function loadTokens(userId: number) {
		const response = await fetch(`/api/users/${userId}/tokens`, { credentials: 'same-origin' });
		tokens = response.ok ? await response.json() : [];
	}

	async function openTokens(userId: number) {
		tokenUserId = userId;
		revealedToken = '';
		copyState = 'idle';
		await loadTokens(userId);
	}

	async function createToken() {
		if (tokenUserId == null) return;
		error = '';
		const response = await fetch(`/api/users/${tokenUserId}/tokens`, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: tokenName })
		});
		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			error = body.message || 'Could not create token';
			return;
		}
		if (typeof body.token !== 'string' || !body.token.startsWith('acct_') || body.token.length < 20) {
			error = 'The server did not return the full token. No token was saved for you to copy.';
			return;
		}
		revealedToken = body.token;
		copyState = 'idle';
		tokenName = '';
		await loadTokens(tokenUserId);
	}

	function dismissToken() {
		revealedToken = '';
		copyState = 'idle';
	}

	async function copyToken() {
		if (!revealedToken) return;
		try {
			if (navigator.clipboard && window.isSecureContext) {
				await navigator.clipboard.writeText(revealedToken);
				copyState = 'copied';
				return;
			}
		} catch {
			/* HTTP pages cannot use the clipboard API. Fall through to a selection. */
		}
		tokenField?.focus();
		tokenField?.select();
		let copied = false;
		try {
			copied = document.execCommand('copy');
		} catch {
			copied = false;
		}
		copyState = copied ? 'copied' : 'manual';
	}

	async function revokeToken(tokenId: number) {
		if (tokenUserId == null) return;
		await fetch(`/api/users/${tokenUserId}/tokens/${tokenId}`, {
			method: 'DELETE',
			credentials: 'same-origin'
		});
		await openTokens(tokenUserId);
	}

	$effect(() => {
		load();
	});
</script>

<div class="card bg-base-100 shadow-xl mb-6">
	<div class="card-body">
		<h2 class="card-title">Users and API tokens</h2>
		<p class="text-sm text-base-content/70">
			Every user can open the enabled modules. Only administrators see Settings and Audit. Rights
			control add, edit, and delete. The last active administrator cannot be removed.
		</p>
		{#if error}<div class="alert alert-error text-sm"><span>{error}</span></div>{/if}
		{#if notice}<div class="alert alert-success text-sm"><span>{notice}</span></div>{/if}
		{#if revealedToken}
			<div class="modal modal-open" role="dialog" aria-modal="true" aria-labelledby="new-token-title">
				<div class="modal-box max-w-xl">
					<h3 id="new-token-title" class="font-bold text-lg">API token created</h3>
					<p class="py-2 text-sm">
						This is the only time the full token is shown. Copy it now. After you close this
						dialog, only a short prefix remains in the list.
					</p>
					<div class="alert alert-warning text-sm mb-3">
						<span>It will not be shown again. If you lose it, revoke it and create a new one.</span>
					</div>
					<label class="form-control w-full">
						<span class="label-text">Token</span>
						<input
							bind:this={tokenField}
							class="input input-bordered w-full font-mono text-xs"
							type="text"
							readonly
							value={revealedToken}
							onclick={(event) => event.currentTarget.select()}
						/>
					</label>
					<div class="modal-action">
						<button class="btn btn-primary" type="button" onclick={copyToken}>
							{copyState === 'copied' ? 'Copied' : 'Copy'}
						</button>
						<button class="btn" type="button" onclick={dismissToken}>I have copied it</button>
					</div>
					{#if copyState === 'manual'}
						<p class="text-sm text-warning">The browser blocked clipboard access. The token is selected in the field above; copy it manually.</p>
					{/if}
				</div>
			</div>
		{/if}

		<div class="overflow-x-auto">
			<table class="table table-zebra">
				<thead>
					<tr>
						<th>Username</th>
						<th>Admin</th>
						<th>Rights</th>
						<th>Active</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						<tr>
							<td class="font-medium">{user.username}</td>
							<td><input type="checkbox" class="checkbox checkbox-sm" bind:checked={user.isAdmin} /></td>
							<td>
								<select class="select select-bordered select-sm" bind:value={user.rights}>
									<option value="add">Add only</option>
									<option value="add_edit">Add + edit</option>
									<option value="add_edit_delete">Add + edit + delete</option>
								</select>
							</td>
							<td><input type="checkbox" class="checkbox checkbox-sm" bind:checked={user.isActive} /></td>
							<td class="flex flex-wrap gap-2">
								<button class="btn btn-xs" onclick={() => saveUser(user)}>Save</button>
								<button class="btn btn-xs btn-ghost" onclick={() => resetPassword(user)}>Reset password</button>
								<button class="btn btn-xs btn-ghost" onclick={() => openTokens(user.id)}>Tokens</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<form class="grid gap-3 md:grid-cols-2 mt-4" onsubmit={createUser}>
			<input class="input input-bordered" placeholder="New username" bind:value={username} required />
			<input class="input input-bordered" type="password" placeholder="Password" bind:value={password} minlength="8" required />
			<select class="select select-bordered" bind:value={rights}>
				<option value="add">Add only</option>
				<option value="add_edit">Add + edit</option>
				<option value="add_edit_delete">Add + edit + delete</option>
			</select>
			<label class="label cursor-pointer justify-start gap-3">
				<input type="checkbox" class="checkbox" bind:checked={isAdmin} />
				<span>Administrator</span>
			</label>
			<button class="btn btn-primary md:col-span-2 w-fit" type="submit">Create user</button>
		</form>

		{#if tokenUserId != null}
			<div class="mt-6 border-t border-base-300 pt-4">
				<h3 class="font-semibold mb-2">API tokens for user #{tokenUserId}</h3>
				<ul class="text-sm space-y-2 mb-3">
					{#each tokens as token}
						<li class="flex items-center justify-between gap-3">
							<span>
								{token.name} · prefix {token.tokenPrefix}
								{#if token.revokedAt}<span class="badge badge-ghost badge-sm">revoked</span>{/if}
							</span>
							{#if !token.revokedAt}
								<button class="btn btn-xs btn-ghost text-error" onclick={() => revokeToken(token.id)}>Revoke</button>
							{/if}
						</li>
					{/each}
				</ul>
				<form class="flex gap-2" onsubmit={(event) => { event.preventDefault(); createToken(); }}>
					<input class="input input-bordered input-sm flex-1" placeholder="Token name, e.g. Bookkeeping assistant" bind:value={tokenName} required />
					<button class="btn btn-sm" type="submit">Create token</button>
				</form>
			</div>
		{/if}
		<p class="text-xs text-base-content/50">{rightsLabel.add} users can create records. Editing and deleting follow the selected level. Administrators can do everything.</p>
	</div>
</div>
