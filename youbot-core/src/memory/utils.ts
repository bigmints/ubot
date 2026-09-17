export function rowToMemory(row: any): any {
	return {
		id: row.id,
		contactId: row.contact_id,
		category: row.category,
		key: row.key,
		value: row.value,
		source: row.source,
		confidence: row.confidence,
		createdAt: new Date(row.created_at),
		updatedAt: new Date(row.updated_at),
		expiresAt: row.expires_at ? new Date(row.expires_at) : null,
	};
}
