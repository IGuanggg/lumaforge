package model

import "testing"

func TestQueryNormalizeClampsPagination(t *testing.T) {
	query := Query{Page: -2, PageSize: MaxPageSize + 100}

	query.Normalize()

	if query.Page != 1 {
		t.Fatalf("expected page to default to 1, got %d", query.Page)
	}
	if query.PageSize != MaxPageSize {
		t.Fatalf("expected page size to clamp to %d, got %d", MaxPageSize, query.PageSize)
	}
}

func TestQueryOffsetUsesNormalizedPagination(t *testing.T) {
	query := Query{Page: 3, PageSize: 25}
	query.Normalize()

	if offset := query.Offset(); offset != 50 {
		t.Fatalf("expected offset 50, got %d", offset)
	}
}
