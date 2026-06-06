<script>
	import LocationPicker from "$lib/LocationPicker.svelte"
	import {
		hasRequiredLocationParts,
		buildCompleteAddress,
	} from "$lib/locationUtils"
	import {lookupLocationDetails} from "$lib/utils"

	let {
		showModal = false,
		modalLocation = null,
		addressText = "",
		pinMovedInModal = false,
		onConfirm = () => {},
		onCancel = () => {},
		disabled = false,
	} = $props()

	let localConfirmedLocation = $state(null)

	async function handleConfirm() {
		if (
			modalLocation &&
			(pinMovedInModal || !hasRequiredLocationParts(localConfirmedLocation))
		) {
			const {location, error} = await lookupLocationDetails(
				modalLocation.lat,
				modalLocation.lon,
			)
			if (error) {
				onConfirm({
					error,
					locationConfirmed: false,
				})
				return
			}
			if (location) {
				localConfirmedLocation = location
				const parts = [
					location.city,
					location.state,
					location.country,
					location.zip,
				].filter(Boolean)
				if (parts.length) {
					onConfirm({
						addressText: parts.join(", "),
						modalLocation: {...modalLocation, ...location},
						confirmedLocation: location,
					})
					return
				}
			}
		}

		if (!hasRequiredLocationParts(localConfirmedLocation)) {
			onConfirm({
				error: "Location must include state, country, and zip before it can be confirmed.",
				locationConfirmed: false,
			})
			return
		}

		const completeAddress = buildCompleteAddress(localConfirmedLocation)
		onConfirm({
			addressText: completeAddress || addressText,
			confirmedAddress: (completeAddress || addressText).trim(),
			locationConfirmed: true,
			confirmedLocation: localConfirmedLocation,
			modalLocation: modalLocation,
			error: "",
		})
	}

	function handleCancel() {
		onCancel()
	}
</script>

{#if showModal}
	<div
		class="modal-overlay"
		role="dialog"
		aria-modal="true"
		aria-label="Confirm location"
	>
		<div class="modal-panel">
			<h2 class="modal-title">Confirm Location</h2>
			<p class="modal-hint">
				Search for your address or move the pin to the exact spot, then
				confirm.
			</p>
			<LocationPicker
				location={modalLocation}
				height={300}
				searchTerms={addressText}
				showConfirmToggle={false}
				autoSearch={true}
				onChange={(loc) => {
					modalLocation = loc
				}}
				onPinMoved={() => {
					pinMovedInModal = true
				}}
			/>
			<div class="modal-actions">
				<button
					class="modal-cancel-btn"
					type="button"
					onclick={handleCancel}
					{disabled}
					>Cancel</button
				>
				<button
					class="modal-confirm-btn"
					type="button"
					onclick={handleConfirm}
					{disabled}
					>Confirm Location</button
				>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		z-index: 2000;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 1rem;
		overflow-y: auto;
	}
	.modal-panel {
		background: rgba(255, 250, 241, 0.98);
		border: 1px solid rgba(58, 91, 65, 0.18);
		border-radius: 16px;
		padding: 1.25rem;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
		width: 100%;
		max-width: 640px;
		margin-top: 2rem;
	}
	.modal-title {
		margin: 0 0 0.4rem;
		font-size: 1.1rem;
	}
	.modal-hint {
		margin: 0 0 0.85rem;
		font-size: 0.9rem;
		color: #5f665f;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.55rem;
		margin-top: 0.85rem;
	}
	.modal-cancel-btn {
		border: 1px solid #bdad9e;
		background: #fff;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font: inherit;
		cursor: pointer;
	}
	.modal-cancel-btn:disabled {
		cursor: not-allowed;
		opacity: 0.58;
	}
	.modal-confirm-btn {
		border: 1px solid #305741;
		background: #3b6e4f;
		color: #fff;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.modal-confirm-btn:hover {
		background: #305741;
	}
	.modal-confirm-btn:disabled {
		cursor: not-allowed;
		opacity: 0.58;
	}
</style>
