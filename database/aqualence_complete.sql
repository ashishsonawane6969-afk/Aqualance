-- ============================================================
-- AQUALENCE VENTURES — iKrish Wellness Distribution System
-- COMPLETE DATABASE SETUP — ONE FILE
--
-- COMPATIBLE WITH:
--   ✅ MySQL Workbench (local)
--   ✅ cPanel / phpMyAdmin (shared hosting)
--   ✅ Railway / PlanetScale / Aiven / Clever Cloud
--   ✅ DigitalOcean Managed MySQL
--   ✅ Any MySQL 5.7+ or 8.0+ host
--
-- HOW TO RUN ON RAILWAY:
--   1. Open your Railway MySQL service → Data tab → Query
--   2. Paste this entire file and run it
--   OR connect via a MySQL client using Railway's connection details
--
-- HOW TO RUN LOCALLY:
--   Workbench : File → Open SQL Script → Execute All (⚡)
--   phpMyAdmin: Import tab → choose this file → Go
--   CLI       : mysql -u root -p aqualence_db < aqualence_complete.sql
--
-- NOTE: CREATE DATABASE and USE statements removed for Railway
--       compatibility. Railway pre-creates the database for you.
--       Run this script while already connected to your database.
--
-- NO stored procedures, NO DELIMITER, NO SOURCE commands.
--
-- LOGIN CREDENTIALS (after import):
--   Admin    : phone 9000000001  password Admin@123
--   Delivery : phone 9000000002  password Delivery@123
--   Delivery : phone 9000000003  password Delivery@123
--   Salesman : phone 9000000004  password Sales@123
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = '';

-- ============================================================
-- DROP ALL TABLES (clean slate — safe re-run)
-- ============================================================
DROP TABLE IF EXISTS `lead_products`;
DROP TABLE IF EXISTS `salesman_areas`;
DROP TABLE IF EXISTS `salesman_tracking`;
DROP TABLE IF EXISTS `shop_leads`;
DROP TABLE IF EXISTS `token_revocations`;
DROP TABLE IF EXISTS `order_items`;
DROP TABLE IF EXISTS `orders`;
DROP TABLE IF EXISTS `products`;
DROP TABLE IF EXISTS `talukas`;
DROP TABLE IF EXISTS `users`;

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE `users` (
  `id`                   INT              NOT NULL AUTO_INCREMENT,
  `name`                 VARCHAR(100)     NOT NULL,
  `phone`                VARCHAR(20)      NOT NULL,
  `password`             VARCHAR(255)     NOT NULL,
  `role`                 ENUM('admin','delivery','salesman') NOT NULL DEFAULT 'delivery',
  `is_active`            TINYINT(1)       NOT NULL DEFAULT 1,
  `failed_attempts`      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`         TIMESTAMP        NULL DEFAULT NULL,
  `must_change_password` TINYINT(1)       NOT NULL DEFAULT 0,
  `taluka_id`            INT              DEFAULT NULL,
  `taluka_name`          VARCHAR(100)     DEFAULT NULL,
  `created_at`           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: talukas
-- ============================================================
CREATE TABLE `talukas` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `name`       VARCHAR(100)  NOT NULL,
  `district`   VARCHAR(100)  NOT NULL,
  `state`      VARCHAR(100)  NOT NULL DEFAULT 'Maharashtra',
  `center_lat` DECIMAL(10,7) NOT NULL,
  `center_lng` DECIMAL(10,7) NOT NULL,
  `radius_km`  DECIMAL(6,2)  NOT NULL DEFAULT 25.00,
  `is_active`  TINYINT(1)    DEFAULT 1,
  `created_at` TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_taluka_district` (`name`, `district`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: products
-- ============================================================
CREATE TABLE `products` (
  `id`          INT             NOT NULL AUTO_INCREMENT,
  `name`        VARCHAR(150)    NOT NULL,
  `description` TEXT,
  `price`       DECIMAL(10,2)   NOT NULL,
  `mrp`         DECIMAL(10,2)   DEFAULT NULL,
  `image`       LONGTEXT        NOT NULL,
  `images`      TEXT            DEFAULT NULL,
  `category`    VARCHAR(100)    NOT NULL DEFAULT 'General',
  `stock`       INT             NOT NULL DEFAULT 100,
  `unit`        VARCHAR(50)     NOT NULL DEFAULT 'piece',
  `is_active`   TINYINT(1)      NOT NULL DEFAULT 1,
  `created_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_products_cat` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: orders
-- ============================================================
CREATE TABLE `orders` (
  `id`            INT             NOT NULL AUTO_INCREMENT,
  `order_number`  VARCHAR(20)     NOT NULL,
  `customer_name` VARCHAR(100)    NOT NULL,
  `shop_name`     VARCHAR(150)    NOT NULL,
  `phone`         VARCHAR(20)     NOT NULL,
  `address`       TEXT            NOT NULL,
  `city`          VARCHAR(100)    NOT NULL,
  `pincode`       VARCHAR(10)     NOT NULL,
  `latitude`      DECIMAL(10,7)   DEFAULT NULL,
  `longitude`     DECIMAL(10,7)   DEFAULT NULL,
  `total_price`   DECIMAL(10,2)   NOT NULL,
  `notes`         TEXT,
  `status`        ENUM('pending','assigned','out_for_delivery','delivered','cancelled')
                  NOT NULL DEFAULT 'pending',
  `delivery_id`   INT             DEFAULT NULL,
  `created_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_orders_number` (`order_number`),
  INDEX `idx_orders_status`   (`status`),
  INDEX `idx_orders_delivery` (`delivery_id`),
  CONSTRAINT `fk_orders_delivery`
    FOREIGN KEY (`delivery_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: order_items
-- ============================================================
CREATE TABLE `order_items` (
  `id`           INT             NOT NULL AUTO_INCREMENT,
  `order_id`     INT             NOT NULL,
  `product_id`   INT             NOT NULL,
  `product_name` VARCHAR(150)    NOT NULL,
  `quantity`     INT             NOT NULL,
  `price`        DECIMAL(10,2)   NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_order_items` (`order_id`),
  CONSTRAINT `fk_items_order`
    FOREIGN KEY (`order_id`)   REFERENCES `orders`   (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_items_product`
    FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: token_revocations
-- ============================================================
CREATE TABLE `token_revocations` (
  `jti`        VARCHAR(36)  NOT NULL,
  `user_id`    INT          NOT NULL,
  `revoked_at` TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` TIMESTAMP    NOT NULL,
  PRIMARY KEY (`jti`),
  INDEX `idx_expires` (`expires_at`),
  INDEX `idx_user`    (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: shop_leads
-- ============================================================
CREATE TABLE `shop_leads` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `salesman_id` INT           NOT NULL,
  `shop_name`   VARCHAR(150)  NOT NULL,
  `shop_type`   VARCHAR(100)  DEFAULT '',
  `owner_name`  VARCHAR(100)  NOT NULL,
  `mobile`      VARCHAR(20)   NOT NULL,
  `village`     VARCHAR(100)  NOT NULL,
  `taluka`      VARCHAR(100)  NOT NULL,
  `district`    VARCHAR(100)  NOT NULL,
  `sale_status` ENUM('YES','NO') NOT NULL DEFAULT 'NO',
  `grand_total` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `photo_proof` MEDIUMTEXT    DEFAULT NULL,
  `notes`       TEXT          DEFAULT NULL,
  `latitude`    DECIMAL(10,7) DEFAULT NULL,
  `longitude`   DECIMAL(10,7) DEFAULT NULL,
  `gps_accuracy` DECIMAL(8,2) DEFAULT NULL,
  `address_geo` TEXT          DEFAULT NULL,
  `geo_verified` TINYINT(1)   DEFAULT 0,
  `distance_km` DECIMAL(8,3)  DEFAULT NULL,
  `visited_at`  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  `created_at`  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_leads_salesman` (`salesman_id`),
  INDEX `idx_leads_status`   (`sale_status`),
  INDEX `idx_leads_visited`  (`visited_at`),
  INDEX `idx_leads_district` (`district`),
  CONSTRAINT `fk_leads_salesman`
    FOREIGN KEY (`salesman_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: lead_products
-- ============================================================
CREATE TABLE `lead_products` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `lead_id`    INT           NOT NULL,
  `product_id` INT           NOT NULL,
  `name`       VARCHAR(150)  NOT NULL,
  `price`      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `quantity`   INT           NOT NULL DEFAULT 1,
  `total`      DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_lp_lead`    (`lead_id`),
  INDEX `idx_lp_product` (`product_id`),
  CONSTRAINT `fk_lp_lead`
    FOREIGN KEY (`lead_id`)    REFERENCES `shop_leads`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lp_product`
    FOREIGN KEY (`product_id`) REFERENCES `products`(`id`)   ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: salesman_tracking
-- ============================================================
CREATE TABLE `salesman_tracking` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `salesman_id` INT           NOT NULL,
  `latitude`    DECIMAL(10,7) NOT NULL,
  `longitude`   DECIMAL(10,7) NOT NULL,
  `accuracy`    DECIMAL(8,2)  DEFAULT NULL,
  `recorded_at` TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_track_salesman` (`salesman_id`),
  INDEX `idx_track_time`     (`recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- TABLE: salesman_areas
-- ============================================================
CREATE TABLE `salesman_areas` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `salesman_id` INT          NOT NULL,
  `taluka`      VARCHAR(100) NOT NULL,
  `district`    VARCHAR(100) NOT NULL,
  `assigned_by` INT          DEFAULT NULL,
  `assigned_at` TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_salesman_taluka` (`salesman_id`, `taluka`),
  INDEX `idx_areas_salesman` (`salesman_id`),
  INDEX `idx_areas_taluka`   (`taluka`),
  CONSTRAINT `fk_areas_salesman`
    FOREIGN KEY (`salesman_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_areas_assigned_by`
    FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- SEED: USERS
-- Bcrypt hashed passwords (cost 10):
--   Admin@123 / Delivery@123 / Sales@123
-- ============================================================
INSERT INTO `users` (`id`,`name`,`phone`,`password`,`role`,`taluka_id`,`taluka_name`) VALUES
(1,'Admin',        '9000000001','$2a$10$Z3gwSdiR8OqVWxDM8HkbTeC89kxpMNztH53ryyIxadxYx8JC6ijzu','admin',   NULL, NULL),
(2,'Ravi Kumar',   '9000000002','$2a$10$I5VASwTh3nK.WWCUcQKa6.xpVhCezo.mLOCDLJPlsd1hROprtAYYO','delivery',NULL, NULL),
(3,'Suresh Patil', '9000000003','$2a$10$3GagQIJtUu9JLKRoUZkf..ps9nffZ6Y98NhZRfoZY1M1lMEvF5Z8m','delivery',NULL, NULL),
(4,'Ajay Salesman','9000000004','$2a$10$/9ITbdwSIivdFfu0Ya9HueuQ1Snbxyq2ZTjy4jBgcLr1yzToKPHAq','salesman',1,    'Sangamner')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- ============================================================
-- SEED: TALUKAS
-- ============================================================
INSERT IGNORE INTO `talukas` (`name`,`district`,`state`,`center_lat`,`center_lng`,`radius_km`) VALUES
('Sangamner',  'Ahmednagar','Maharashtra',19.5741,74.2103,25.00),
('Rahuri',     'Ahmednagar','Maharashtra',19.3917,74.6497,20.00),
('Shrirampur', 'Ahmednagar','Maharashtra',19.6225,74.6514,22.00),
('Kopargaon',  'Ahmednagar','Maharashtra',19.8935,74.4780,22.00),
('Nevasa',     'Ahmednagar','Maharashtra',19.5594,74.9855,20.00),
('Pathardi',   'Ahmednagar','Maharashtra',18.8624,75.1914,20.00),
('Ahmednagar', 'Ahmednagar','Maharashtra',19.0948,74.7480,28.00),
('Shevgaon',   'Ahmednagar','Maharashtra',19.3449,75.6872,20.00),
('Parner',     'Ahmednagar','Maharashtra',19.0015,74.4359,22.00),
('Rahata',     'Ahmednagar','Maharashtra',19.7160,74.4760,25.00),
('Akole',      'Ahmednagar','Maharashtra',19.5200,74.0200,25.00);

-- ============================================================
-- SEED: PRODUCTS
-- ============================================================
INSERT INTO `products` (`name`,`description`,`price`,`mrp`,`image`,`category`,`stock`,`unit`) VALUES
('iKrish Aloe Vera Face Wash 100ml',     'Gentle daily face wash with pure aloe vera extract. Removes dirt and excess oil without stripping moisture.',          120.00,150.00,'','Face Care',   200,'bottle'),
('iKrish Brightening Face Cream 50g',    'Daily brightening cream with niacinamide and vitamin C. Reduces dark spots and evens skin tone.',                     180.00,220.00,'','Face Care',   150,'piece'),
('iKrish Anti-Acne Face Wash 100ml',     'Salicylic acid face wash to combat acne, pimples and blackheads.',                                                   135.00,165.00,'','Face Care',   180,'bottle'),
('iKrish Moisturising Night Cream 50g',  'Rich overnight repair cream with shea butter and retinol.',                                                          250.00,299.00,'','Face Care',   100,'piece'),
('iKrish Protein Repair Shampoo 200ml',  'Keratin-enriched shampoo for damaged and dry hair.',                                                                 180.00,210.00,'','Hair Care',   200,'bottle'),
('iKrish Anti-Dandruff Shampoo 200ml',   'Zinc pyrithione formula targets dandruff-causing fungus.',                                                           165.00,195.00,'','Hair Care',   180,'bottle'),
('iKrish Onion Hair Oil 100ml',          'Cold-pressed onion seed oil blend to fight hair fall.',                                                              220.00,260.00,'','Hair Care',   120,'bottle'),
('iKrish Almond & Honey Soap 100g',      'Premium bathing bar with natural almond oil and pure honey.',                                                         60.00, 75.00,'','Body Care',   500,'piece'),
('iKrish Rose Bathing Bar 100g',         'Luxurious rose extract soap enriched with glycerin.',                                                                  55.00, 70.00,'','Body Care',   500,'piece'),
('iKrish Nourishing Body Lotion 200ml',  'Lightweight daily body lotion with shea butter and vitamin E.',                                                      195.00,240.00,'','Body Care',   200,'bottle'),
('iKrish De-Tan Body Scrub 200g',        'Walnut shell and papaya enzyme scrub to remove dead skin and tan.',                                                  210.00,250.00,'','Body Care',   100,'piece'),
('iKrish Sanitizing Wipes (20 Sheets)',  '70% isopropyl alcohol wipes. Kills 99.9% of germs.',                                                                  80.00, 99.00,'','Essentials',  300,'pack'),
('iKrish Makeup Remover Wipes (25 Sheets)','Gentle micellar wipes with cucumber extract.',                                                                      95.00,115.00,'','Essentials',  250,'pack'),
('iKrish Hand Sanitizer Gel 100ml',      'WHO-formula instant hand sanitizer with 70% alcohol.',                                                                 65.00, 80.00,'','Essentials',  350,'bottle'),
('iKrish Vitamin C Serum 30ml',          '15% stabilised vitamin C serum with hyaluronic acid. Brightens and fades pigmentation.',                             450.00,550.00,'','New Launches', 80,'bottle'),
('iKrish Hair Growth Serum 50ml',        'Biotin and redensyl serum to reduce hair fall. Apply to scalp.',                                                     380.00,450.00,'','New Launches', 60,'bottle');

-- ============================================================
-- SEED: ORDERS
-- ============================================================
INSERT INTO `orders`
  (`id`,`order_number`,`customer_name`,`shop_name`,`phone`,`address`,`city`,`pincode`,`latitude`,`longitude`,`total_price`,`status`,`delivery_id`)
VALUES
(1,'AQ-20240001','Ramesh Sharma','Sharma General Store','9876543210','12 MG Road, Near Bus Stand',   'Sangamner','422605',19.5741,74.2103,480.00,'pending', NULL),
(2,'AQ-20240002','Priya Desai',  'Desai Kirana Mart',  '9845678901','45 Market Yard, Shivaji Chowk','Sangamner','422605',19.5680,74.2050,825.00,'assigned',2);

-- ============================================================
-- SEED: ORDER ITEMS
-- ============================================================
INSERT INTO `order_items` (`order_id`,`product_id`,`product_name`,`quantity`,`price`) VALUES
(1, 8,'iKrish Almond & Honey Soap 100g',    4, 60.00),
(1, 1,'iKrish Aloe Vera Face Wash 100ml',   2,120.00),
(2, 5,'iKrish Protein Repair Shampoo 200ml',3,180.00),
(2,10,'iKrish Nourishing Body Lotion 200ml',1,195.00),
(2,12,'iKrish Sanitizing Wipes (20 Sheets)',2, 80.00);

-- ============================================================
-- SEED: SHOP LEADS
-- ============================================================
INSERT INTO `shop_leads`
  (`salesman_id`,`shop_name`,`shop_type`,`owner_name`,`mobile`,`village`,`taluka`,`district`,`sale_status`,`notes`,`visited_at`)
VALUES
(4,'Patil General Store',   'Kirana',   'Sunil Patil',   '9812345670','Nimgaon',   'Sangamner', 'Ahmednagar','YES','Interested in Face Wash & Soap combo',       NOW() - INTERVAL 2 DAY),
(4,'Shree Medical & Stores','Medical',  'Prashant More', '9823456781','Korhale',   'Sangamner', 'Ahmednagar','NO', 'Will call back next week',                   NOW() - INTERVAL 1 DAY),
(4,'Om Kirana Bhandar',     'Kirana',   'Ganesh Shinde', '9834567892','Wambori',   'Rahuri',    'Ahmednagar','YES','Ordered 2 dozen soaps and shampoos',          NOW() - INTERVAL 3 DAY),
(4,'New Maharashtra Store', 'Wholesale','Raju Deshpande','9845678903','Shrirampur','Shrirampur','Ahmednagar','NO', 'Already has a supplier, revisit next month',  NOW() - INTERVAL 4 DAY),
(4,'Sainath Provisions',    'General',  'Vijay Kadam',   '9856789014','Savargaon', 'Sangamner', 'Ahmednagar','YES','Very interested, placed trial order',         NOW());

-- ============================================================
-- SEED: SALESMAN AREA ASSIGNMENTS
-- ============================================================
INSERT IGNORE INTO `salesman_areas` (`salesman_id`,`taluka`,`district`,`assigned_by`) VALUES
(4,'Sangamner','Ahmednagar',1),
(4,'Rahuri',   'Ahmednagar',1);

-- ============================================================
-- VERIFY
-- ============================================================
SELECT
  t.table_name,
  t.table_rows AS approx_rows
FROM information_schema.tables t
WHERE t.table_schema = DATABASE()
ORDER BY t.table_name;
