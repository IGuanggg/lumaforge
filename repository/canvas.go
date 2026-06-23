package repository

import (
	"errors"

	"github.com/IGuanggg/lumaforge/model"
	"gorm.io/gorm"
)

// FindCanvasProject returns one canvas owned by the user, including tombstones.
func FindCanvasProject(id string, userID string) (model.CanvasProject, bool, error) {
	db, err := DB()
	if err != nil {
		return model.CanvasProject{}, false, err
	}
	item := model.CanvasProject{}
	err = db.Where("id = ? AND user_id = ?", id, userID).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return model.CanvasProject{}, false, nil
	}
	return item, err == nil, err
}

// ListCanvasProjects returns active canvases and optional deletion tombstones.
func ListCanvasProjects(userID string, offset int, limit int, includeDeleted bool) ([]model.CanvasProject, int64, error) {
	db, err := DB()
	if err != nil {
		return nil, 0, err
	}
	query := db.Model(&model.CanvasProject{}).Where("user_id = ?", userID)
	if !includeDeleted {
		query = query.Where("deleted_at IS NULL")
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := []model.CanvasProject{}
	if err := query.Order("updated_at DESC").Offset(offset).Limit(limit).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// SaveCanvasProject creates or replaces a validated canvas record.
func SaveCanvasProject(item model.CanvasProject) (model.CanvasProject, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

// DeleteCanvasProject stores a tombstone instead of removing user data immediately.
func DeleteCanvasProject(item model.CanvasProject) (model.CanvasProject, error) {
	return SaveCanvasProject(item)
}
