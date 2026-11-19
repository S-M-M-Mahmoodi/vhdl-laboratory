--------------------------------------------------------------------------------
-- Project Name : switch_to_seg
-- Entity Name  : switch_to_seg
-- Description  : Board Lab demo - two DIP-switch nibbles shown on a
--                7-segment display as two hex digits, with an enable LED.
--------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity switch_to_seg is
  port (
    sw      : in  std_logic_vector(7 downto 0);  -- 8 DIP switches
    en      : in  std_logic;                     -- push button: display enable
    hex_hi  : out std_logic_vector(3 downto 0);  -- high digit  (sw 7..4)
    hex_lo  : out std_logic_vector(3 downto 0);  -- low digit   (sw 3..0)
    led_on  : out std_logic                      -- lights when enabled
  );
end entity switch_to_seg;

architecture Behavioral of switch_to_seg is
begin
  hex_hi <= sw(7 downto 4) when en = '1' else (others => '0');
  hex_lo <= sw(3 downto 0) when en = '1' else (others => '0');
  led_on <= en;
end architecture Behavioral;