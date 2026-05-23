package main

import (
	"fmt"
	"log"

	"mailman/internal/config"
	"mailman/internal/database"
	"mailman/internal/models"
	"mailman/internal/repository"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	// 加载配置
	cfg := config.Load()

	// 初始化数据库
	dbConfig := database.Config{
		Driver:   cfg.Database.Driver,
		Host:     cfg.Database.Host,
		Port:     cfg.Database.Port,
		User:     cfg.Database.User,
		Password: cfg.Database.Password,
		DBName:   cfg.Database.DBName,
		SSLMode:  cfg.Database.SSLMode,
	}

	if err := database.Initialize(dbConfig); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.Close()

	db := database.GetDB()

	// 创建用户仓库
	userRepo := repository.NewUserRepository(db)

	// 创建测试用户
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte("test123"), bcrypt.DefaultCost)
	if err != nil {
		log.Fatal("Failed to hash password:", err)
	}

	testUser := &models.User{
		Username:     "test",
		Email:        "test@example.com",
		PasswordHash: string(hashedPassword),
		IsActive:     true,
	}

	// 检查用户是否已存在
	existingUser, _ := userRepo.GetByUsername("test")
	if existingUser != nil {
		fmt.Println("Test user already exists")
		return
	}

	// 创建用户
	if err := userRepo.Create(testUser); err != nil {
		log.Fatal("Failed to create test user:", err)
	}

	fmt.Println("Test user created successfully:")
	fmt.Printf("Username: %s\n", testUser.Username)
	fmt.Printf("Email: %s\n", testUser.Email)
	fmt.Printf("Password: test123\n")
}
