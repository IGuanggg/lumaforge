package repository

import (
	"testing"

	"github.com/IGuanggg/lumaforge/model"
)

func TestUserCreditConsumeAndRefund(t *testing.T) {
	useTempRepositoryDB(t)

	_, err := SaveUser(model.User{
		ID:        "user-credit",
		Username:  "credit-user",
		Role:      model.UserRoleUser,
		Status:    model.UserStatusActive,
		Credits:   30,
		CreatedAt: "2026-06-14T00:00:00Z",
		UpdatedAt: "2026-06-14T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("SaveUser failed: %v", err)
	}

	user, ok, err := ConsumeUserCredits("user-credit", 12, "2026-06-14T00:01:00Z")
	if err != nil || !ok {
		t.Fatalf("ConsumeUserCredits expected success, ok=%v err=%v", ok, err)
	}
	if user.Credits != 18 {
		t.Fatalf("expected credits after consume to be 18, got %d", user.Credits)
	}

	user, ok, err = ConsumeUserCredits("user-credit", 99, "2026-06-14T00:02:00Z")
	if err != nil {
		t.Fatalf("over-consume returned error: %v", err)
	}
	if ok {
		t.Fatalf("expected over-consume to fail")
	}
	if user.Credits != 18 {
		t.Fatalf("expected over-consume to leave credits at 18, got %d", user.Credits)
	}

	user, ok, err = RefundUserCredits("user-credit", 7, "2026-06-14T00:03:00Z")
	if err != nil || !ok {
		t.Fatalf("RefundUserCredits expected success, ok=%v err=%v", ok, err)
	}
	if user.Credits != 25 {
		t.Fatalf("expected credits after refund to be 25, got %d", user.Credits)
	}
}

func TestHasAdminReflectsSavedUsers(t *testing.T) {
	useTempRepositoryDB(t)

	hasAdmin, err := HasAdmin()
	if err != nil {
		t.Fatalf("HasAdmin failed: %v", err)
	}
	if hasAdmin {
		t.Fatalf("expected no admin in empty test database")
	}

	_, err = SaveUser(model.User{
		ID:       "admin-user",
		Username: "admin",
		Role:     model.UserRoleAdmin,
		Status:   model.UserStatusActive,
	})
	if err != nil {
		t.Fatalf("SaveUser failed: %v", err)
	}
	hasAdmin, err = HasAdmin()
	if err != nil {
		t.Fatalf("HasAdmin after SaveUser failed: %v", err)
	}
	if !hasAdmin {
		t.Fatalf("expected saved admin to be detected")
	}
}
