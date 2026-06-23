package repository

import (
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestCanvasRepositoryIsolatesUsersWithSameCanvasID(t *testing.T) {
	useTempRepositoryDB(t)

	for _, item := range []model.CanvasProject{
		{ID: "shared-id", UserID: "user-a", Title: "A", ClientUpdatedAt: "2026-06-22T01:00:00Z", UpdatedAt: "2026-06-22T01:00:00Z"},
		{ID: "shared-id", UserID: "user-b", Title: "B", ClientUpdatedAt: "2026-06-22T02:00:00Z", UpdatedAt: "2026-06-22T02:00:00Z"},
	} {
		if _, err := SaveCanvasProject(item); err != nil {
			t.Fatalf("SaveCanvasProject(%s) failed: %v", item.UserID, err)
		}
	}

	for userID, wantTitle := range map[string]string{"user-a": "A", "user-b": "B"} {
		got, found, err := FindCanvasProject("shared-id", userID)
		if err != nil || !found {
			t.Fatalf("FindCanvasProject(%s) = found %v, err %v", userID, found, err)
		}
		if got.Title != wantTitle {
			t.Fatalf("FindCanvasProject(%s).Title = %q, want %q", userID, got.Title, wantTitle)
		}
	}
}

func TestCanvasRepositoryListsTombstonesOnlyWhenRequested(t *testing.T) {
	useTempRepositoryDB(t)
	deletedAt := "2026-06-22T03:00:00Z"
	for _, item := range []model.CanvasProject{
		{ID: "active", UserID: "user-a", UpdatedAt: "2026-06-22T02:00:00Z"},
		{ID: "deleted", UserID: "user-a", UpdatedAt: deletedAt, DeletedAt: &deletedAt},
	} {
		if _, err := SaveCanvasProject(item); err != nil {
			t.Fatalf("SaveCanvasProject(%s) failed: %v", item.ID, err)
		}
	}

	active, total, err := ListCanvasProjects("user-a", 0, 20, false)
	if err != nil || total != 1 || len(active) != 1 || active[0].ID != "active" {
		t.Fatalf("active list = total %d, items %#v, err %v", total, active, err)
	}
	all, total, err := ListCanvasProjects("user-a", 0, 20, true)
	if err != nil || total != 2 || len(all) != 2 {
		t.Fatalf("full list = total %d, items %#v, err %v", total, all, err)
	}
}
