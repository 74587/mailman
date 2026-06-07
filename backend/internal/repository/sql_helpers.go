package repository

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func quoteColumn(db *gorm.DB, name string) string {
	parts := strings.Split(name, ".")
	stmt := &gorm.Statement{DB: db}

	for i, part := range parts {
		parts[i] = stmt.Quote(clause.Column{Name: part})
	}

	return strings.Join(parts, ".")
}

func textLikeExpr(db *gorm.DB, column string) string {
	quoted := quoteColumn(db, column)
	if db.Dialector.Name() == "postgres" {
		return fmt.Sprintf("%s::text LIKE ?", quoted)
	}
	return fmt.Sprintf("%s LIKE ?", quoted)
}

func textNotLikeExpr(db *gorm.DB, column string) string {
	quoted := quoteColumn(db, column)
	if db.Dialector.Name() == "postgres" {
		return fmt.Sprintf("%s::text NOT LIKE ?", quoted)
	}
	return fmt.Sprintf("%s NOT LIKE ?", quoted)
}

func buildOrderClause(db *gorm.DB, sortBy, sortOrder string, allowedColumns map[string]string, defaultColumn string) string {
	column := defaultColumn
	if mapped, ok := allowedColumns[sortBy]; ok {
		column = mapped
	}

	direction := "DESC"
	if strings.EqualFold(sortOrder, "asc") {
		direction = "ASC"
	}

	return fmt.Sprintf("%s %s", quoteColumn(db, column), direction)
}
