package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/IGuanggg/lumaforge/model"
)

type response struct {
	Code      int    `json:"code"`
	Data      any    `json:"data"`
	Msg       string `json:"msg"`
	ErrorCode string `json:"errorCode,omitempty"`
	Action    string `json:"action,omitempty"`
}

func OK(w http.ResponseWriter, data any) {
	writeJSON(w, response{Code: 0, Data: data, Msg: "ok"})
}

func Fail(w http.ResponseWriter, msg string) {
	writeJSON(w, response{Code: 1, Data: nil, Msg: msg})
}

func FailUser(w http.ResponseWriter, err *UserError) {
	if err == nil {
		Fail(w, "操作失败，请稍后重试")
		return
	}
	writeJSON(w, response{Code: 1, Data: nil, Msg: err.Message, ErrorCode: err.Code, Action: err.Action})
}

func FailError(w http.ResponseWriter, err error) {
	log.Printf("request failed: %v", err)
	if userErr, ok := err.(*UserError); ok {
		FailUser(w, userErr)
		return
	}
	if safe, ok := err.(interface{ SafeMessage() string }); ok {
		Fail(w, safe.SafeMessage())
		return
	}
	Fail(w, "操作失败，请稍后重试")
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(value)
}

func parseQuery(r *http.Request) model.Query {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	pageSize, _ := strconv.Atoi(q.Get("pageSize"))
	return model.Query{
		Keyword:  q.Get("keyword"),
		Tags:     q["tag"],
		Category: q.Get("category"),
		Type:     q.Get("type"),
		Page:     page,
		PageSize: pageSize,
	}
}
