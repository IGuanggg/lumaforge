package main

import (
	"log"

	"github.com/IGuanggg/lumaforge/config"
	"github.com/IGuanggg/lumaforge/router"
	"github.com/IGuanggg/lumaforge/service"
)

func main() {
	if err := config.Load(); err != nil {
		log.Fatal(err)
	}
	if err := service.EnsureDefaultAdmin(); err != nil {
		log.Fatal(err)
	}
	service.RunLumaMigration()
	service.StartPromptSyncScheduler()
	log.Fatal(router.New().Run(":" + config.Cfg.Port))
}
