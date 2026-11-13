----------------------------------------------------------------------------------
-- Project Name : and22
-- Module Name  : and22.vhd
-- Entity Name  : and22
-- Architecture : Behavioral
-- Target Lang  : VHDL-2008
-- Engineer     : Jalali
-- Create Date  : 2026-11-06
-- Tool Versions: GHDL 6.0.0
----------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity and22 is
  port (
    A            : in    std_logic;
    B            : in    std_logic;
    Y            : out   std_logic
  );
end entity and22;

architecture Behavioral of and22 is
    
  -- Component declaration for or22
  component or22 is
    port (
    A                : in     std_logic;
    B                : in     std_logic;
    Y                : out    std_logic
    );
  end component or22;

begin

  Y <= a and b;
    
  -- Component instantiation for or22
  U_or22 : or22
    port map (
    A                => A,
    B                => B,
    Y                => Y
    );


end architecture Behavioral;
