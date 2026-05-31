-- Migration: add deep_compressed column to savings table
ALTER TABLE savings ADD COLUMN deep_compressed INTEGER DEFAULT 0;
