package handler

import (
	"net/http"

	"github.com/basketikun/infinite-canvas/service"
)

func LumaMigrationStatus(w http.ResponseWriter, r *http.Request) {
	OK(w, service.LumaMigrationStatus())
}

func LumaMigrationImport(w http.ResponseWriter, r *http.Request) {
	OK(w, service.LumaMigrationImport())
}
